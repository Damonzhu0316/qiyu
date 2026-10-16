"""Volunteer-facing choice and rating tasks for RideChoice."""
from __future__ import annotations

import csv
import io
import json
import random
import secrets
from collections import Counter


class AnnotationTools:
    def __init__(self, **backend):
        self.b = backend

    def migrate(self, con):
        con.executescript('''
        CREATE TABLE IF NOT EXISTS identities(token_hash TEXT PRIMARY KEY,nickname TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL,last_seen TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS annotation_projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,
          prompt TEXT NOT NULL,consent TEXT NOT NULL DEFAULT '',mode TEXT NOT NULL,options TEXT NOT NULL,score_min INTEGER,score_max INTEGER,
          score_min_label TEXT NOT NULL,score_max_label TEXT NOT NULL,status INTEGER NOT NULL DEFAULT 0,
          created TEXT NOT NULL,updated TEXT NOT NULL,sample_size INTEGER NOT NULL DEFAULT 0,is_demo INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS annotation_items(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES annotation_projects(id),
          image TEXT NOT NULL,name TEXT NOT NULL,metadata TEXT NOT NULL,position INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS annotation_sessions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES annotation_projects(id),
          nickname TEXT NOT NULL,plan TEXT NOT NULL,consent TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,finished TEXT);
        CREATE TABLE IF NOT EXISTS annotation_answers(session_id TEXT NOT NULL REFERENCES annotation_sessions(id),
          item_id TEXT NOT NULL REFERENCES annotation_items(id),choice TEXT NOT NULL,score INTEGER,note TEXT NOT NULL,created TEXT NOT NULL,
          PRIMARY KEY(session_id,item_id));
        CREATE INDEX IF NOT EXISTS annotation_projects_status ON annotation_projects(status,mode);
        CREATE INDEX IF NOT EXISTS annotation_sessions_project ON annotation_sessions(project_id,created);
        ''')
        project_columns={r['name'] for r in con.execute('PRAGMA table_info(annotation_projects)')}
        if 'consent' not in project_columns:
            con.execute("ALTER TABLE annotation_projects ADD COLUMN consent TEXT NOT NULL DEFAULT ''")
        if 'sample_size' not in project_columns:
            con.execute('ALTER TABLE annotation_projects ADD COLUMN sample_size INTEGER NOT NULL DEFAULT 0')
        if 'is_demo' not in project_columns:
            con.execute('ALTER TABLE annotation_projects ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0')
        if 'selection_type' not in project_columns:
            con.execute("ALTER TABLE annotation_projects ADD COLUMN selection_type TEXT NOT NULL DEFAULT 'single'")
        item_columns={r['name'] for r in con.execute('PRAGMA table_info(annotation_items)')}
        if 'images_json' not in item_columns:
            con.execute("ALTER TABLE annotation_items ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'")
        session_columns={r['name'] for r in con.execute('PRAGMA table_info(annotation_sessions)')}
        if 'consent' not in session_columns:
            con.execute("ALTER TABLE annotation_sessions ADD COLUMN consent TEXT NOT NULL DEFAULT ''")
        if 'candidate_orders' not in session_columns:
            con.execute("ALTER TABLE annotation_sessions ADD COLUMN candidate_orders TEXT NOT NULL DEFAULT '{}'")

    def authenticate(self, handler):
        cookie = handler.headers.get('Cookie', '')
        token = next((p.strip()[len('ride_role='):] for p in cookie.split(';') if p.strip().startswith('ride_role=')), '')
        if not token:
            return None
        digest = self.b['hashlib'].sha256(token.encode()).hexdigest()
        with self.b['connect']() as con:
            row = con.execute('SELECT nickname,role FROM identities WHERE token_hash=?', (digest,)).fetchone()
            if row:
                con.execute('UPDATE identities SET last_seen=? WHERE token_hash=?', (self.b['now'](), digest))
                return {'nickname': row['nickname'], 'role': row['role']}
        return None

    def login(self, body):
        b = self.b
        nickname = b['short'](body.get('nickname', ''), 40)
        role = body.get('role')
        b['require'](nickname, '请填写昵称')
        b['require'](role in ('volunteer', 'manager'), '请选择志愿者或管理人员身份')
        token = b['secrets'].token_urlsafe(32)
        digest = b['hashlib'].sha256(token.encode()).hexdigest()
        with b['connect']() as con:
            con.execute('INSERT INTO identities VALUES(?,?,?,?,?)', (digest, nickname, role, b['now'](), b['now']()))
        return {'nickname': nickname, 'role': role, 'token': token}

    def task_list(self, mode):
        b = self.b
        b['require'](mode in ('choice', 'rating'), '实验类型无效')
        with b['connect']() as con:
            annotation = con.execute('''SELECT p.*,COUNT(i.id) item_count FROM annotation_projects p
                LEFT JOIN annotation_items i ON i.project_id=p.id WHERE p.mode=? AND p.status=1 GROUP BY p.id
                ORDER BY p.created DESC''', (mode,)).fetchall()
            results = [{'id': r['id'], 'kind': 'annotation', 'mode': r['mode'], 'title': r['title'],
                'description': r['description'], 'item_count': r['item_count'], 'prompt': r['prompt'], 'consent': r['consent'],
                'options': json.loads(r['options']), 'score_min': r['score_min'], 'score_max': r['score_max'],
                'score_min_label': r['score_min_label'], 'score_max_label': r['score_max_label'],
                'sample_size': r['sample_size'], 'is_demo': bool(r['is_demo']), 'selection_type':r['selection_type']} for r in annotation]
            if mode == 'choice':
                legacy = con.execute('''SELECT v.code,v.number,v.config,COUNT(s.id) sessions FROM versions v
                    JOIN experiments e ON e.id=v.experiment_id LEFT JOIN sessions s ON s.code=v.code AND s.preview=0
                    WHERE v.active=1 AND v.demo=0 GROUP BY v.code ORDER BY v.created DESC''').fetchall()
                results += [{'id': r['code'], 'kind': 'route', 'mode': 'choice',
                    'title': json.loads(r['config'])['title'], 'description': json.loads(r['config'])['description'],
                    'item_count': len(json.loads(r['config'])['questions']), 'responses': r['sessions']} for r in legacy]
        return {'tasks': results, 'mode': mode}

    def create_project(self, body):
        b = self.b
        title = b['short'](body.get('title', ''), 100)
        description = b['short'](body.get('description', ''), 1000)
        prompt = b['short'](body.get('prompt', ''), 500)
        consent = b['short'](body.get('consent', ''), 2000)
        mode = body.get('mode')
        b['require'](title and prompt and consent, '请填写实验名称、任务问题和参与说明')
        b['require'](mode in ('choice', 'rating'), '请选择选择或打分模式')
        images = body.get('images')
        b['require'](isinstance(images, list) and 1 <= len(images) <= 5000, '请从素材库选择 1–5000 张图片')
        selection_type=body.get('selection_type','single') if mode=='choice' else 'single'
        b['require'](selection_type in ('single','best','worst','realistic'),'请选择有效的选择题类型')
        images_per_question=body.get('images_per_question',1) if selection_type!='single' else 1
        if selection_type!='single':
            b['require'](isinstance(images_per_question,int) and not isinstance(images_per_question,bool) and 2<=images_per_question<=6,'每道多图比较题需选择 2–6 张图片')
        question_count=len(images)//images_per_question
        b['require'](question_count>=1,'所选图片不足以组成一道多图比较题')
        sample_size = body.get('sample_size', min(3,question_count))
        b['require'](isinstance(sample_size, int) and not isinstance(sample_size, bool)
                     and 1 <= sample_size <= question_count, '每位参与者抽题数不能超过题库题目数')
        seen, rows = set(), []
        with b['connect']() as con:
            for index, image in enumerate(images):
                b['require'](isinstance(image, str) and b['local_asset'](image) and not image.startswith('/demo/'), '请选择已导入的研究素材；演示图片不能用于正式数据实验')
                b['require'](image not in seen, '图片重复，请检查所选素材')
                seen.add(image)
                asset = con.execute('SELECT name,source,location,captured,heading,tags,note,archived FROM assets WHERE image=?', (image,)).fetchone()
                b['require'](asset and not asset['archived'], '所选素材不存在或已归档')
                metadata = {k: asset[k] for k in ('source','location','captured','heading','tags','note')}
                rows.append({'image':image,'name':asset['name'],'metadata':metadata})
        project_id = b['uid']()
        if selection_type!='single':
            random.SystemRandom().shuffle(rows)
        bundles=[rows[i:i+images_per_question] for i in range(0,len(rows)-images_per_question+1,images_per_question)]
        item_rows=[]
        for pos,bundle in enumerate(bundles,1):
            item_rows.append((b['uid'](),project_id,bundle[0]['image'],bundle[0]['name'] if len(bundle)==1 else f'比较题 {pos:02d}（{len(bundle)} 张）',
                b['encode'](bundle[0]['metadata']),pos,b['encode'](bundle)))
        options = []
        score_min = score_max = None
        low_label = high_label = ''
        if mode == 'choice':
            raw = body.get('options', [])
            options = list(dict.fromkeys(b['short'](x, 120) for x in raw if isinstance(x, str) and x.strip())) if isinstance(raw, list) else []
            if selection_type=='single':b['require'](2 <= len(options) <= 20, '单图识别请设置 2–20 个答案选项')
        else:
            score_min = body.get('score_min', 1); score_max = body.get('score_max', 5)
            b['require'](isinstance(score_min, int) and not isinstance(score_min,bool) and isinstance(score_max, int) and not isinstance(score_max,bool) and 0 <= score_min < score_max <= 100, '评分范围需为 0–100 内的整数，且最大值大于最小值')
            low_label = b['short'](body.get('score_min_label', ''), 80)
            high_label = b['short'](body.get('score_max_label', ''), 80)
        stamp = b['now']()
        with b['connect']() as con:
            con.execute('''INSERT INTO annotation_projects(id,title,description,prompt,consent,mode,options,score_min,score_max,
                score_min_label,score_max_label,status,created,updated,sample_size,is_demo,selection_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)''',
                (project_id,title,description,prompt,consent,mode,b['encode'](options),score_min,score_max,low_label,high_label,int(body.get('publish') is True),stamp,stamp,sample_size,selection_type))
            con.executemany('INSERT INTO annotation_items(id,project_id,image,name,metadata,position,images_json) VALUES(?,?,?,?,?,?,?)', item_rows)
            b['audit'](con, '创建数据实验', project_id, {'mode':mode,'items':len(item_rows),'selection_type':selection_type,'published':body.get('publish') is True})
        return {'id': project_id, 'items': len(item_rows), 'assets':len(rows), 'sample_size': sample_size, 'published': body.get('publish') is True}

    def seed_demo_projects(self):
        """Install clearly marked practice pools using only bundled demonstration images."""
        b = self.b
        specs = [
            {'key':'choice-space','title':'演示题库｜骑行空间识别','description':'练习判断街景中骑行空间的连续性与独立性。系统每次从示范题库抽取3题。','prompt':'从这幅街景看，骑行者是否拥有相对连续、独立于机动车的通行空间？','mode':'choice','options':['有，空间相对独立且连续','部分独立或连续性不足','没有，与机动车混行','无法判断'],'score_min':None,'score_max':None,'low':'','high':''},
            {'key':'choice-detour','title':'演示题库｜骑行环境偏好','description':'练习记录参与者对街景骑行环境的主观偏好。系统每次从示范题库抽取3题。','prompt':'如果这条道路是你的出行路线，你愿意为了更好的骑行环境多骑几分钟吗？','mode':'choice','options':['愿意','不愿意','视具体情况而定'],'score_min':None,'score_max':None,'low':'','high':''},
            {'key':'choice-best-pair','title':'演示题库｜双图选更适合骑行的场景','description':'每题并列展示两幅街景，请选择你认为更适合真实骑行的一幅。每次随机抽取3题。','prompt':'两幅街景中，哪一幅更符合你理想中的真实骑行场景？','mode':'choice','selection_type':'realistic','images_per_question':2,'options':[],'score_min':None,'score_max':None,'low':'','high':''},
            {'key':'choice-worst-triple','title':'演示题库｜三图选最不愿骑的场景','description':'每题展示三幅街景，请选择你最不愿意骑行的一幅。每次随机抽取2题。','prompt':'三幅街景中，你最不愿意选择哪一幅作为骑行路线？','mode':'choice','selection_type':'worst','images_per_question':3,'options':[],'score_min':None,'score_max':None,'low':'','high':''},
            {'key':'rating-safety','title':'演示题库｜骑行安全感评分','description':'练习按个人感受评价街景中的骑行安全感。系统每次从示范题库抽取3题。','prompt':'请根据画面判断这段道路带给你的骑行安全感。','mode':'rating','options':[],'score_min':1,'score_max':5,'low':'很不安全','high':'很安全'},
            {'key':'rating-comfort','title':'演示题库｜骑行舒适度评分','description':'练习评价街景环境对骑行的舒适与友好程度。系统每次从示范题库抽取3题。','prompt':'请根据画面评价这段道路对骑行者的舒适和友好程度。','mode':'rating','options':[],'score_min':1,'score_max':5,'low':'很不舒适','high':'很舒适'},
            {'key':'rating-legibility','title':'演示题库｜骑行环境可辨识度','description':'练习评价道路空间和通行信息是否清晰易懂。系统每次从示范题库抽取3题。','prompt':'仅根据画面，你觉得骑行者能否清楚辨认可通行空间与道路边界？','mode':'rating','options':[],'score_min':1,'score_max':5,'low':'很难辨认','high':'非常清晰'},
            {'key':'rating-stress','title':'演示题库｜主观骑行压力评分','description':'练习根据街景画面判断骑行者可能感受到的压力。系统每次从示范题库抽取3题。','prompt':'设想你正在这段道路骑行，你预计会感到多大压力？','mode':'rating','options':[],'score_min':1,'score_max':5,'low':'压力很小','high':'压力很大'},
        ]
        with b['connect']() as con:
            for spec in specs:
                project_id = b['hashlib'].sha256(('ridechoice-demo-' + spec['key']).encode()).hexdigest()[:32]
                if con.execute('SELECT 1 FROM annotation_projects WHERE id=?',(project_id,)).fetchone():
                    continue
                stamp=b['now']()
                choice_count=spec.get('images_per_question',1)
                item_count=6//choice_count
                sample_size=min(3,item_count)
                con.execute('''INSERT INTO annotation_projects(id,title,description,prompt,consent,mode,options,score_min,score_max,
                    score_min_label,score_max_label,status,created,updated,sample_size,is_demo,selection_type)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)''',
                    (project_id,spec['title'],spec['description'],spec['prompt'],
                     '这是系统内置的练习题库，使用带水印的示范街景图片。回答仅用于熟悉流程，不属于正式研究数据。',
                     spec['mode'],b['encode'](spec['options']),spec['score_min'],spec['score_max'],spec['low'],spec['high'],1,stamp,stamp,sample_size,spec.get('selection_type','single')))
                bundle=[]
                for position in range(1,7):
                    image=f'/demo/scene-{position}.jpg'
                    metadata={'source':'系统内置演示素材，仅用于练习，不用于正式研究','location':'','captured':'','heading':'','tags':['演示素材'],'note':'图片带有地图平台标识，正式研究请替换为已核验来源的自有素材。'}
                    bundle.append({'image':image,'name':f'演示街景 {position:02d}','metadata':metadata})
                    if len(bundle)==choice_count:
                        item_pos=(position-1)//choice_count+1
                        item_id=b['hashlib'].sha256(f'{project_id}:{item_pos}'.encode()).hexdigest()[:32]
                        con.execute('INSERT INTO annotation_items(id,project_id,image,name,metadata,position,images_json) VALUES(?,?,?,?,?,?,?)',
                            (item_id,project_id,bundle[0]['image'],f'演示比较题 {item_pos:02d}',b['encode'](bundle[0]['metadata']),item_pos,b['encode'](bundle)))
                        bundle=[]

    def public_project(self, project_id):
        with self.b['connect']() as con:
            row=con.execute('''SELECT p.*,COUNT(i.id) item_count FROM annotation_projects p
                LEFT JOIN annotation_items i ON i.project_id=p.id WHERE p.id=? AND p.status=1 GROUP BY p.id''',(project_id,)).fetchone()
            self.b['require'](row,'实验未开放或不存在',404)
            return {'id':row['id'],'title':row['title'],'description':row['description'],'prompt':row['prompt'],
                'consent':row['consent'],'mode':row['mode'],'item_count':row['item_count'],
                'sample_size':row['sample_size'],'is_demo':bool(row['is_demo']),'selection_type':row['selection_type']}

    def project_status(self, project_id, active):
        b = self.b
        with b['connect']() as con:
            cur = con.execute('UPDATE annotation_projects SET status=?,updated=? WHERE id=?', (int(active),b['now'](),project_id))
            b['require'](cur.rowcount, '实验不存在', 404)
            b['audit'](con, '调整数据实验状态', project_id, {'published': bool(active)})
        return {'ok': True, 'published': bool(active)}

    def manager_projects(self):
        with self.b['connect']() as con:
            rows = con.execute('''SELECT p.*,COUNT(DISTINCT i.id) items,COUNT(DISTINCT s.nickname) volunteers,COUNT(DISTINCT s.id) sessions,
                COUNT(DISTINCT a.session_id || ':' || a.item_id) answers FROM annotation_projects p LEFT JOIN annotation_items i ON i.project_id=p.id
                LEFT JOIN annotation_sessions s ON s.project_id=p.id LEFT JOIN annotation_answers a ON a.session_id=s.id
                GROUP BY p.id ORDER BY p.created DESC''').fetchall()
            return {'projects': [{**dict(r), 'options': json.loads(r['options'])} for r in rows]}

    def view_answers(self, project_id, page=1):
        b=self.b
        b['require'](isinstance(page,int) and 1<=page<=1000000,'页码无效')
        with b['connect']() as con:
            project=con.execute('SELECT id,title,mode,is_demo,sample_size,selection_type FROM annotation_projects WHERE id=?',(project_id,)).fetchone()
            b['require'](project,'实验不存在',404)
            total=con.execute('''SELECT COUNT(*) FROM annotation_answers a JOIN annotation_sessions s ON s.id=a.session_id
                WHERE s.project_id=?''',(project_id,)).fetchone()[0]
            rows=con.execute('''SELECT s.nickname,s.id session_id,s.created session_started,s.plan,i.position,i.id item_id,i.name item_name,
                i.image,i.images_json,a.choice,a.score,a.note,a.created answered_at FROM annotation_answers a
                JOIN annotation_sessions s ON s.id=a.session_id JOIN annotation_items i ON i.id=a.item_id
                WHERE s.project_id=? ORDER BY a.created DESC LIMIT 200 OFFSET ?''',(project_id,(page-1)*200)).fetchall()
            answer_rows=[]
            for row in rows:
                item=dict(row); plan=json.loads(item.pop('plan'))
                item['draw_order']=plan.index(item['item_id'])+1 if item['item_id'] in plan else None
                candidates=json.loads(item.pop('images_json') or '[]')
                item['candidate_images']=candidates
                selected=next((c for c in candidates if c['image']==item['choice']),None)
                item['selected_image_name']=selected['name'] if selected else ''
                item['selected_image']=selected['image'] if selected else ''
                if selected:item['choice']=selected['name']
                answer_rows.append(item)
            return {'project':{**dict(project),'is_demo':bool(project['is_demo'])},'page':page,'page_size':200,'total':total,'rows':answer_rows}

    def export(self, project_id):
        b = self.b
        with b['connect']() as con:
            project = con.execute('SELECT * FROM annotation_projects WHERE id=?',(project_id,)).fetchone()
            b['require'](project, '实验不存在', 404)
            sessions=con.execute('SELECT * FROM annotation_sessions WHERE project_id=? ORDER BY created',(project_id,)).fetchall()
            items={r['id']:dict(r) for r in con.execute('SELECT * FROM annotation_items WHERE project_id=?',(project_id,)).fetchall()}
            answers={(r['session_id'],r['item_id']):dict(r) for r in con.execute('''SELECT a.* FROM annotation_answers a
                JOIN annotation_sessions s ON s.id=a.session_id WHERE s.project_id=?''',(project_id,)).fetchall()}
            rows=[]
            for session in sessions:
                candidate_orders=json.loads(session['candidate_orders'] or '{}')
                for draw_order,item_id in enumerate(json.loads(session['plan']),1):
                    item=items.get(item_id)
                    if not item: continue
                    answer=answers.get((session['id'],item_id),{})
                    candidates=json.loads(item['images_json'] or '[]') or [{'image':item['image'],'name':item['name'],'metadata':json.loads(item['metadata'])}]
                    by_image={candidate['image']:candidate for candidate in candidates}
                    presented=[by_image[path] for path in candidate_orders.get(item_id,[c['image'] for c in candidates]) if path in by_image]
                    rows.append({'nickname':session['nickname'],'session_id':session['id'],'session_started':session['created'],
                        'finished':session['finished'],'consent':session['consent'],'position':draw_order,'item_id':item_id,
                        'name':item['name'],'image':item['image'],'metadata':item['metadata'],'candidate_images':b['encode'](candidates),
                        'presented_candidates':b['encode'](presented),
                        'choice':answer.get('choice',''),'selected_image_name':next((c['name'] for c in candidates if c['image']==answer.get('choice')),''),
                        'score':answer.get('score'),'note':answer.get('note',''),'answered_at':answer.get('created','')})
            b['audit'](con,'导出志愿者实验数据',project_id,{'rows':len(rows)})
            output=io.StringIO(newline='');writer=csv.writer(output)
            writer.writerow(['project_id','project_title','mode','selection_type','is_demo','nickname','consent_text','session_id','session_started_utc','session_finished_utc','draw_order','item_id','item_name','image','candidate_images_json','presented_candidates_json','source_metadata_json','choice','selected_image_name','score','note','answered_at_utc'])
            for row in rows:
                values=[project_id,project['title'],project['mode'],project['selection_type'],bool(project['is_demo']),*[row[k] for k in ('nickname','consent','session_id','session_started','finished','position','item_id','name','image','candidate_images','presented_candidates','metadata','choice','selected_image_name','score','note','answered_at')]]
                writer.writerow([b['safe_csv'](value) for value in values])
            data=('\ufeff'+output.getvalue()).encode('utf-8')
            return data

    def start(self, project_id, consent, identity):
        b=self.b
        b['require'](identity and identity['role']=='volunteer','请先以志愿者身份登录',401)
        b['require'](consent is True,'请先阅读参与说明并确认自愿参与')
        with b['connect']() as con:
            project=con.execute('SELECT * FROM annotation_projects WHERE id=? AND status=1',(project_id,)).fetchone()
            b['require'](project,'实验未开放或不存在',404)
            existing=con.execute('SELECT id FROM annotation_sessions WHERE project_id=? AND nickname=? AND finished IS NULL ORDER BY created DESC LIMIT 1',(project_id,identity['nickname'])).fetchone()
            if existing:
                sid=existing['id']
            else:
                pool=[r['id'] for r in con.execute('SELECT id FROM annotation_items WHERE project_id=? ORDER BY position',(project_id,))]
                b['require'](pool,'实验题目为空',409)
                sample_size=project['sample_size'] or len(pool)
                b['require'](1<=sample_size<=len(pool),'题库抽题数设置无效',409)
                items=random.SystemRandom().sample(pool,sample_size)
                candidate_orders={}
                for item_id in items:
                    itemrow=con.execute('SELECT images_json,image,name,metadata FROM annotation_items WHERE id=?',(item_id,)).fetchone()
                    candidates=json.loads(itemrow['images_json'] or '[]') or [{'image':itemrow['image'],'name':itemrow['name'],'metadata':json.loads(itemrow['metadata'])}]
                    random.SystemRandom().shuffle(candidates)
                    candidate_orders[item_id]=[c['image'] for c in candidates]
                sid=b['uid']()
                con.execute('''INSERT INTO annotation_sessions(id,project_id,nickname,plan,consent,created,finished,candidate_orders)
                    VALUES(?,?,?,?,?,?,NULL,?)''',(sid,project_id,identity['nickname'],b['encode'](items),project['consent'],b['now'](),b['encode'](candidate_orders)))
                b['audit'](con,'志愿者开始数据实验',project_id,{'mode':project['mode']})
        return self.state(sid, identity)

    def state(self, sid, identity):
        b=self.b
        b['require'](identity and identity['role']=='volunteer','请先以志愿者身份登录',401)
        with b['connect']() as con:
            session=con.execute('SELECT * FROM annotation_sessions WHERE id=? AND nickname=?',(sid,identity['nickname'])).fetchone()
            b['require'](session,'作答记录不存在',404)
            project=con.execute('SELECT * FROM annotation_projects WHERE id=?',(session['project_id'],)).fetchone()
            done={r['item_id'] for r in con.execute('SELECT item_id FROM annotation_answers WHERE session_id=?',(sid,))}
            item_ids=json.loads(session['plan']); next_id=next((x for x in item_ids if x not in done),None)
            item=None
            if next_id:
                row=con.execute('SELECT * FROM annotation_items WHERE id=?',(next_id,)).fetchone()
                item={**dict(row),'metadata':json.loads(row['metadata'])}
                candidates=json.loads(row['images_json'] or '[]') or [{'image':row['image'],'name':row['name'],'metadata':item['metadata']}]
                by_image={c['image']:c for c in candidates}
                order=json.loads(session['candidate_orders'] or '{}').get(next_id,[c['image'] for c in candidates])
                item['candidates']=[by_image[path] for path in order if path in by_image]
            complete=next_id is None
            if complete and not session['finished']:
                con.execute('UPDATE annotation_sessions SET finished=? WHERE id=?',(b['now'](),sid))
            return {'session_id':sid,'nickname':session['nickname'],'done':len(done),'total':len(item_ids),'complete':complete,
                'project':{k:project[k] for k in ('id','title','description','prompt','mode','score_min','score_max','score_min_label','score_max_label','selection_type')}|{'options':json.loads(project['options']),'sample_size':project['sample_size'],'is_demo':bool(project['is_demo'])},'item':item}

    def answer(self,sid,body,identity):
        b=self.b
        state=self.state(sid,identity)
        b['require'](not state['complete'],'本实验已经完成',409)
        item=state['item'];project=state['project'];item_id=body.get('item_id')
        b['require'](item_id==item['id'],'题目已变化，请刷新后继续',409)
        choice='';score=None
        if project['mode']=='choice':
            choice=b['short'](body.get('choice',''),120)
            if project.get('selection_type','single')!='single':
                b['require'](choice in {c['image'] for c in item.get('candidates',[])},'请选择一张图片作为答案')
            else:b['require'](choice in project['options'],'请选择一个有效答案')
        else:
            score=body.get('score')
            b['require'](isinstance(score,int) and not isinstance(score,bool) and project['score_min']<=score<=project['score_max'],'评分超出设置范围')
            choice=str(score)
        note=b['short'](body.get('note',''),500)
        with b['connect']() as con:
            con.execute('INSERT INTO annotation_answers VALUES(?,?,?,?,?,?)',(sid,item_id,choice,score,note,b['now']()))
            done=con.execute('SELECT COUNT(*) FROM annotation_answers WHERE session_id=?',(sid,)).fetchone()[0]
            total=len(json.loads(con.execute('SELECT plan FROM annotation_sessions WHERE id=?',(sid,)).fetchone()['plan']))
            if done==total:con.execute('UPDATE annotation_sessions SET finished=? WHERE id=?',(b['now'](),sid))
        return self.state(sid,identity)
