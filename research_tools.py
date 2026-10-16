"""骑遇骑行街景选择实验与偏好分析平台 V1.2 — research workspace services.

Asset management, reproducible candidate design, review, descriptive analysis and reports.
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import itertools
import json
import math
import random
import re
import statistics
from collections import Counter, defaultdict
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

SOFTWARE_NAME = '骑遇骑行街景选择实验与偏好分析平台'
SOFTWARE_VERSION = 'V1.2'


def normalize_config(config, require, number, short):
    blocks = number(config.get('block_count', 1), 1, 10, '题组数量')
    require(blocks == int(blocks), '题组数量应为整数')
    config['block_count'] = int(blocks)
    require(blocks <= len(config['questions']), '题组数量不能多于题目数量')
    present = set()
    for i, question in enumerate(config['questions']):
        block = number(question.get('block', i % int(blocks) + 1), 1, blocks, '题目所属组')
        require(block == int(block), '题目所属组应为整数')
        question['block'] = int(block)
        present.add(int(block))
        question['theme'] = short(question.get('theme', '日常骑行'), 80)
    require(len(present) == blocks, '每个题组至少需要一道题，请先分配题目')
    return config


def write_csv(headers, rows, safe):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(headers)
    writer.writerows([[safe(value) for value in row] for row in rows])
    return ('\ufeff' + stream.getvalue()).encode('utf-8')


class ResearchTools:
    def __init__(self, **backend):
        self.b = SimpleNamespace(**backend)

    def audit(self, con, action, subject='', details=None):
        con.execute('INSERT INTO audit_log(created,action,subject,details) VALUES(?,?,?,?)',
                    (self.b.now(), action, str(subject)[:160], self.b.encode(details or {})))

    def register_asset(self, con, image, name='', metadata=None):
        metadata = metadata or {}
        stamp = self.b.now()
        con.execute('''INSERT OR IGNORE INTO assets(image,name,source,location,captured,heading,tags,note,archived,created,updated)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)''', (image, name or image.rsplit('/', 1)[-1], metadata.get('source', ''),
            metadata.get('location', ''), metadata.get('captured', ''), metadata.get('heading', ''),
            self.b.encode(['演示示例'] if image.startswith('/demo/') else []), '', 0, stamp, stamp))

    def migrate(self, con):
        con.executescript('''CREATE TABLE IF NOT EXISTS assets(image TEXT PRIMARY KEY,name TEXT NOT NULL,
            source TEXT NOT NULL,location TEXT NOT NULL,captured TEXT NOT NULL,heading TEXT NOT NULL,
            tags TEXT NOT NULL,note TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS reviews(session_id TEXT PRIMARY KEY REFERENCES sessions(id),status TEXT NOT NULL,
            note TEXT NOT NULL,updated TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,
            action TEXT NOT NULL,subject TEXT NOT NULL,details TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS design_runs(id TEXT PRIMARY KEY,experiment_id TEXT NOT NULL,
            created TEXT NOT NULL,spec TEXT NOT NULL,summary TEXT NOT NULL);''')
        columns = {r['name'] for r in con.execute('PRAGMA table_info(sessions)')}
        if 'block_index' not in columns:
            con.execute('ALTER TABLE sessions ADD COLUMN block_index INTEGER NOT NULL DEFAULT 1')
        configs = [json.loads(r['config']) for r in con.execute('SELECT config FROM experiments')]
        configs += [json.loads(r['config']) for r in con.execute('SELECT config FROM versions')]
        for config in configs:
            for q in config['questions']:
                for key in ('a', 'b'):
                    a = q[key]
                    if a.get('image') and self.b.local_asset(a['image']):
                        self.register_asset(con, a['image'], metadata=a)
        if not con.execute('SELECT 1 FROM audit_log LIMIT 1').fetchone():
            self.audit(con, '系统升级', SOFTWARE_VERSION, {'description': '历史数据保留；操作日志从本版本开始记录'})

    def assets(self, include_archived=True):
        with self.b.connect() as con:
            rows = con.execute('SELECT * FROM assets ORDER BY archived,updated DESC,image').fetchall()
            usage = Counter()
            for r in con.execute('SELECT config FROM experiments'):
                for q in json.loads(r['config'])['questions']:
                    usage.update(a.get('image') for a in (q['a'], q['b']) if a.get('image'))
            result = []
            for row in rows:
                if row['archived'] and not include_archived:
                    continue
                item = dict(row)
                item['tags'] = json.loads(item['tags'])
                item['demo'] = item['image'].startswith('/demo/')
                item['uses_in_drafts'] = usage[item['image']]
                item['metadata_complete'] = all(item[k] for k in ('source', 'location', 'captured', 'heading'))
                result.append(item)
            return {'assets': result, 'total': len(result),
                    'active': sum(not a['archived'] for a in result), 'formal': sum(not a['demo'] and not a['archived'] for a in result)}

    def save_asset(self, body):
        b = self.b
        image = b.short(body.get('image', ''), 150)
        file = b.local_asset(image)
        b.require(file is not None and file.is_file(), '素材文件不存在')
        values = {k: b.short(body.get(k, ''), limit) for k, limit in
                  [('name', 200), ('source', 500), ('location', 150), ('captured', 50), ('heading', 100), ('note', 1000)]}
        b.require(values['name'], '请填写素材名称')
        tags = body.get('tags', [])
        b.require(isinstance(tags, list) and len(tags) <= 20, '每张图片最多20个标签')
        tags = list(dict.fromkeys(b.short(t, 30) for t in tags if t))
        with b.connect() as con:
            self.register_asset(con, image)
            con.execute('UPDATE assets SET name=?,source=?,location=?,captured=?,heading=?,tags=?,note=?,updated=? WHERE image=?',
                        (values['name'], values['source'], values['location'], values['captured'], values['heading'],
                         b.encode(tags), values['note'], b.now(), image))
            self.audit(con, '保存素材资料', image, {'name': values['name'], 'tags': tags})
        return {'ok': True}

    def quality(self, code, fast_ms=1500):
        b = self.b
        b.number(fast_ms, 0, 60000, '快速作答参考时长')
        with b.connect() as con:
            version = b.get_version(con, code)
            rows = con.execute('''SELECT s.*,COALESCE(r.status,'pending') review_status,
                COALESCE(r.note,'') review_note,COALESCE(r.updated,'') reviewed_at FROM sessions s
                LEFT JOIN reviews r ON r.session_id=s.id WHERE s.code=? ORDER BY s.created DESC''', (code,)).fetchall()
            result = []
            codes = Counter(json.loads(r['profile']).get('participant_code') for r in rows if not r['preview'])
            for row in rows:
                item = dict(row)
                profile = json.loads(item.pop('profile'))
                plan = json.loads(item.pop('plan'))
                item.pop('seed')
                item.pop('consent')
                item.pop('current_issued')
                answers = con.execute('SELECT * FROM answers WHERE session_id=? ORDER BY position', (row['id'],)).fetchall()
                elapsed = [a['elapsed_ms'] for a in answers]
                active = [a['active_ms'] for a in answers if a['active_ms'] is not None]
                sides = Counter(a['side'] for a in answers)
                flags = []
                fast = sum(a['elapsed_ms'] < fast_ms for a in answers)
                if fast:
                    flags.append(f'{fast}题低于当前参考时长')
                if len(answers) >= 2 and len(sides) == 1:
                    flags.append('已答题目均选择同一展示选项')
                if profile.get('participant_code') and codes[profile['participant_code']] > 1:
                    flags.append('研究编号重复（需人工核实）')
                if not item['finished']:
                    flags.append('尚未完成')
                item.update(profile=profile, total=len(plan), answered=len(answers), flags=flags,
                            fast_count=fast, min_ms=min(elapsed) if elapsed else None,
                            median_ms=statistics.median(elapsed) if elapsed else None,
                            mean_visible_ms=round(statistics.mean(active)) if active else None,
                            hidden_count=sum(a['hidden_count'] for a in answers), side_counts=dict(sides))
                result.append(item)
            return {'experiment': b.public_config(version), 'fast_ms': fast_ms, 'sessions': result,
                    'counts': dict(Counter(r['review_status'] for r in result))}

    def save_review(self, body):
        b = self.b
        sid = b.short(body.get('id', ''), 80)
        status = body.get('status')
        b.require(status in ('pending', 'include', 'exclude'), '审查状态不正确')
        note = b.short(body.get('note', ''), 1000)
        b.require(status != 'exclude' or note, '排除记录时请填写原因')
        with b.connect() as con:
            b.require(con.execute('SELECT 1 FROM sessions WHERE id=?', (sid,)).fetchone(), '作答记录不存在', 404)
            con.execute('''INSERT INTO reviews VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE
                SET status=excluded.status,note=excluded.note,updated=excluded.updated''', (sid, status, note, b.now()))
            self.audit(con, '更新质量审查', sid[:8], {'status': status, 'note': note})
        return {'ok': True}

    def analysis(self, code):
        b = self.b
        with b.connect() as con:
            version = b.get_version(con, code)
            config = json.loads(version['config'])
            qmap = {q['id']: q for q in config['questions']}
            sessions = con.execute('''SELECT s.*,COALESCE(r.status,'pending') review_status FROM sessions s
                LEFT JOIN reviews r ON r.session_id=s.id WHERE s.code=? AND s.preview=0''', (code,)).fetchall()
            eligible = {s['id']: s for s in sessions if s['finished'] and s['review_status'] != 'exclude'}
            answers = con.execute('''SELECT a.* FROM answers a JOIN sessions s ON s.id=a.session_id
                WHERE s.code=? ORDER BY s.created,a.position''', (code,)).fetchall()
            answers = [a for a in answers if a['session_id'] in eligible]
            group_rows, time_rows, block_rows = {}, {}, {}
            for dimension in ('frequency', 'purpose', 'experience'):
                grouped = defaultdict(lambda: {'sessions': 0, 'answers': 0, 'longer': 0, 'shorter': 0, 'equal': 0, 'neither': 0})
                for session in eligible.values():
                    grouped[json.loads(session['profile'])[dimension]]['sessions'] += 1
                for a in answers:
                    label = json.loads(eligible[a['session_id']]['profile'])[dimension]
                    row = grouped[label]
                    row['answers'] += 1
                    q = qmap[a['question_id']]
                    if a['choice'] == 'neither':
                        row['neither'] += 1
                    else:
                        delta = q[a['choice']]['time'] - q['b' if a['choice'] == 'a' else 'a']['time']
                        row['longer' if delta > 0 else 'shorter' if delta < 0 else 'equal'] += 1
                group_rows[dimension] = [{'label': label, **values} for label, values in sorted(grouped.items())]
            for block in range(1, config.get('block_count', 1) + 1):
                assigned = [s for s in sessions if s['block_index'] == block]
                block_rows[block] = {'block': block, 'questions': sum(q.get('block', 1) == block for q in config['questions']),
                                     'started': len(assigned), 'completed': sum(bool(s['finished']) for s in assigned),
                                     'eligible': sum(s['id'] in eligible for s in assigned)}
            for a in answers:
                q = qmap[a['question_id']]
                diff = abs(q['a']['time'] - q['b']['time'])
                row = time_rows.setdefault(diff, {'extra_minutes': diff, 'answers': 0, 'longer': 0, 'shorter': 0, 'equal': 0, 'neither': 0})
                row['answers'] += 1
                if a['choice'] == 'neither':
                    row['neither'] += 1
                else:
                    delta = q[a['choice']]['time'] - q['b' if a['choice'] == 'a' else 'a']['time']
                    row['longer' if delta > 0 else 'shorter' if delta < 0 else 'equal'] += 1
            confidence = Counter(a['confidence'] or '未填写' for a in answers)
            return {'experiment': b.public_config(version), 'eligible_sessions': len(eligible),
                    'excluded_sessions': sum(s['review_status'] == 'exclude' for s in sessions),
                    'completed_sessions': sum(bool(s['finished']) for s in sessions), 'answers': len(answers),
                    'groups': group_rows, 'time_tradeoffs': [time_rows[k] for k in sorted(time_rows)],
                    'blocks': list(block_rows.values()), 'confidence': dict(confidence),
                    'config_sha256': hashlib.sha256(version['config'].encode()).hexdigest(),
                    'rule': '本版本、已完成、非预览、未被人工排除；待审记录暂时计入。'}

    def design(self, body):
        b = self.b
        eid = b.short(body.get('id', ''), 64)
        with b.connect() as con:
            stored = con.execute('SELECT config FROM experiments WHERE id=?', (eid,)).fetchone()
            b.require(stored, '请先选择并保存实验', 404)
            config = json.loads(stored['config'])
        pairs = body.get('pairs', [])
        b.require(isinstance(pairs, list) and 1 <= len(pairs) <= 20, '请选择1–20组街景配对')
        library = {a['image']: a for a in self.assets(False)['assets']}
        for pair in pairs:
            b.require(isinstance(pair, dict), '配对格式不正确')
            b.require(pair.get('a') in library and pair.get('b') in library and pair['a'] != pair['b'], '每组请选择两张不同的未归档街景')
        levels = {}
        for key, low, high, label in [('base_times', 1, 180, '基础骑行时间'), ('extras', 0, 60, '额外骑行时间'), ('stops', 0, 30, '信号灯数量')]:
            values = body.get(key, [])
            b.require(isinstance(values, list) and 1 <= len(values) <= 10, label + '需要1–10个水平')
            levels[key] = list(dict.fromkeys(b.number(v, low, high, label) for v in values))
        b.require(all(v == int(v) for v in levels['stops']), '信号灯数量应为整数')
        count = b.number(body.get('count', 12), 1, 100, '生成题数')
        blocks = b.number(body.get('blocks', 1), 1, 10, '题组数量')
        b.require(count == int(count) and blocks == int(blocks) and blocks <= count, '题数和题组应为整数，题组不能多于题目')
        seed = b.short(body.get('seed', ''), 100)
        b.require(seed, '请填写随机种子，便于复现设计')
        theme = b.short(body.get('theme', '日常骑行'), 80)
        candidates = list(itertools.product(range(len(pairs)), levels['base_times'], levels['extras'], levels['stops'], levels['stops']))
        b.require(count <= len(candidates), f'当前只有 {len(candidates)} 个不同属性组合，请减少生成题数或增加水平')
        chosen = random.Random(seed).sample(candidates, int(count))
        questions = []
        for index, (pi, base, extra, sa, sb) in enumerate(chosen):
            q = {'id': b.uid(), 'prompt': '你更愿意选择哪条路线？', 'context': '', 'theme': theme, 'block': index % int(blocks) + 1}
            for key, minutes, stops in [('a', base, sa), ('b', base + extra, sb)]:
                asset = library[pairs[pi][key]]
                q[key] = {field: asset[field] for field in ('image', 'source', 'location', 'captured', 'heading')}
                q[key].update(time=minutes, stops=int(stops), facility='请结合画面判断')
            questions.append(q)
        spec = {'pairs': pairs, **levels, 'count': int(count), 'blocks': int(blocks), 'seed': seed, 'theme': theme}
        summary = {'candidates': len(candidates), 'selected': len(questions),
                   'block_sizes': dict(Counter(q['block'] for q in questions)),
                   'method': '属性水平全组合候选库 + 固定种子不放回抽样；非正交或D高效设计'}
        config.update(questions=questions, block_count=int(blocks), design_spec=spec, design_summary=summary)
        config = b.validate_config(config)
        warnings = self.design_diagnostics(config)
        if body.get('apply') is True:
            with b.connect() as con:
                con.execute('UPDATE experiments SET config=?,updated=? WHERE id=?', (b.encode(config), b.now(), eid))
                con.execute('INSERT INTO design_runs VALUES(?,?,?,?,?)', (b.uid(), eid, b.now(), b.encode(spec), b.encode(summary)))
                self.audit(con, '应用题组设计', eid, summary)
        return {'config': config, 'summary': summary, 'diagnostics': warnings, 'applied': body.get('apply') is True}

    def design_diagnostics(self, config):
        warnings, exact, levels = [], Counter(), {'a_time': Counter(), 'b_time': Counter(), 'difference': Counter()}
        for i, q in enumerate(config['questions'], 1):
            a, c = q['a'], q['b']
            fingerprint = self.b.encode([a['image'], c['image'], a['time'], c['time'], a['stops'], c['stops'], a['facility'], c['facility']])
            exact[fingerprint] += 1
            levels['a_time'][a['time']] += 1
            levels['b_time'][c['time']] += 1
            levels['difference'][abs(a['time'] - c['time'])] += 1
            if a['image'] == c['image']:
                warnings.append(f'第{i}题使用相同图片，请确认设计意图')
            if a['time'] == c['time'] and a['stops'] == c['stops']:
                warnings.append(f'第{i}题时间和信号灯相同，选择主要依赖街景与文字条件')
            if a['time'] < c['time'] and a['stops'] < c['stops']:
                warnings.append(f'第{i}题A在时间和信号灯上同时占优，请核查是否符合研究目的')
        duplicates = sum(n - 1 for n in exact.values() if n > 1)
        if duplicates:
            warnings.append(f'存在{duplicates}道完全重复的图片与属性组合')
        return {'warnings': warnings, 'levels': {key: [{'value': value, 'count': n} for value, n in sorted(counts.items())] for key, counts in levels.items()},
                'blocks': dict(Counter(q.get('block', 1) for q in config['questions'])),
                'note': '检查提示仅帮助核查资料与组合，不构成实验效度或统计效率证明。'}

    def sessions_csv(self, code):
        data = self.quality(code)
        headers = ['session_id','experiment_code','is_demo','is_preview','block_index','completed','answered','total',
                   'review_status','review_note','reviewed_at_utc','frequency','purpose','experience','participant_code',
                   'min_ms_server','median_ms_server','mean_visible_ms_client','hidden_count_client','started_at_utc','finished_at_utc']
        rows = []
        for s in data['sessions']:
            rows.append([s['id'],code,int(data['experiment']['demo']),s['preview'],s['block_index'],int(bool(s['finished'])),s['answered'],s['total'],
                         s['review_status'],s['review_note'],s['reviewed_at'], *[s['profile'][k] for k in ('frequency','purpose','experience','participant_code')],
                         s['min_ms'] if s['min_ms'] is not None else '',s['median_ms'] if s['median_ms'] is not None else '',
                         s['mean_visible_ms'] if s['mean_visible_ms'] is not None else '',s['hidden_count'],s['created'],s['finished'] or ''])
        return write_csv(headers, rows, self.b.safe_csv)

    def report(self, code):
        b = self.b
        analysis, stats = self.analysis(code), b.stats(code)
        with b.connect() as con:
            version = b.get_version(con, code)
            config = json.loads(version['config'])
            review_counts = dict(Counter(r['status'] for r in con.execute('''SELECT r.status FROM reviews r JOIN sessions s ON s.id=r.session_id
                WHERE s.code=? AND s.preview=0''', (code,))))
        e = html.escape
        def table(headers, rows):
            return '<table><thead><tr>' + ''.join('<th>'+e(str(h))+'</th>' for h in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+e(str(cell))+'</td>' for cell in row)+'</tr>' for row in rows) + '</tbody></table>'
        qrows = [[i, q.get('block', 1), q['a']['time'], q['b']['time'], q['a']['stops'], q['b']['stops'],
                  stats['questions'][i-1]['a'], stats['questions'][i-1]['b'], stats['questions'][i-1]['neither']] for i, q in enumerate(config['questions'], 1)]
        groups = ''.join('<h3>'+label+'</h3>'+table(['分组','完成记录','回答数','选较长','选较短','等时选择','都不选'],
            [[r['label'],r['sessions'],r['answers'],r['longer'],r['shorter'],r['equal'],r['neither']] for r in analysis['groups'][key]])
            for key, label in [('frequency','按骑行频率'),('purpose','按骑行目的'),('experience','按骑行经验')])
        sources = {}
        for q in config['questions']:
            for a in (q['a'], q['b']):
                sources.setdefault(a['image'], a)
        return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>{e(config['title'])} · 实验报告</title>
        <style>body{{font-family:"Microsoft YaHei",sans-serif;color:#253e46;max-width:1000px;margin:45px auto;padding:0 30px;font-size:13px;line-height:1.9}}h1{{font-size:28px}}h2{{font-size:20px;border-bottom:1px solid #cddfe4;padding-bottom:9px;margin-top:30px}}h3{{font-size:15px}}table{{border-collapse:collapse;width:100%;font-size:11px;margin:15px 0}}th,td{{border:1px solid #d8e2e5;padding:8px;text-align:left;overflow-wrap:anywhere}}th{{background:#eaf2f5}}.note{{padding:15px;background:#f0f6f7;border-left:3px solid #6b9ba7}}.muted{{color:#7b9097}}@media print{{body{{margin:0;max-width:none;padding:0}}h2,h3{{break-after:avoid}}tr{{break-inside:avoid}}@page{{size:A4;margin:18mm}}}}</style>
        <p class="muted">{SOFTWARE_NAME} {SOFTWARE_VERSION} · 可使用浏览器打印保存为PDF</p><h1>{e(config['title'])}</h1>
        <p>版本 {version['number']} · {e('演示版本' if version['demo'] else '正式版本')} · 代码 {e(code)} · 报告生成时间（UTC）：{e(b.now())}</p>
        <div class="note">这是已保存数据的描述性报告。演示、预览、未完成、排除记录具有独立标记；报告不能证明因果关系、实验效度或最大额外骑行时间。</div>
        <h2>一、实验说明</h2><p>{e(config['description'])}</p><p>共同情境：{e(config['context'])}</p><p>题库共{len(config['questions'])}题，{config.get('block_count',1)}个题组；题序随机：{'是' if config['random_order'] else '否'}，左右随机：{'是' if config['random_sides'] else '否'}。</p>
        <h2>二、记录与审查</h2>{table(['开始记录','完成记录','未完成','可汇总完成记录','人工排除记录','汇总回答数'],[[stats['started'],stats['completed'],stats['incomplete'],analysis['eligible_sessions'],analysis['excluded_sessions'],analysis['answers']]])}
        <p>汇总口径：{e(analysis['rule'])} 记录数不等于独立受试者人数。人工审查状态计数：{e(json.dumps(review_counts,ensure_ascii=False))}。</p>
        <h2>三、逐题选择分布</h2>{table(['题号','题组','A时间','B时间','A信号灯','B信号灯','原始A','原始B','都不选'],qrows)}
        <h2>四、分群描述</h2>{groups}<h2>五、时间差分布</h2>{table(['时间差/分钟','回答数','选较长','选较短','等时选择','都不选'],[[r['extra_minutes'],r['answers'],r['longer'],r['shorter'],r['equal'],r['neither']] for r in analysis['time_tradeoffs']])}
        <h2>六、素材来源记录</h2>{table(['图片路径','来源及使用依据','地点','拍摄日期','视角'],[[a['image'],a['source'],a['location'],a['captured'],a['heading']] for a in sources.values()])}
        <h2>七、设计与证据边界</h2><p>题目属性为研究者设置或由设计助手生成。全组合候选库抽样不等于正交或高效设计。图片季节、视角、交通状态等仍可能影响选择。待审记录暂计入，排除理由可从研究端导出核查。本报告不运行统计显著性检验或离散选择模型。</p>
        <p>配置 SHA-256：{e(analysis['config_sha256'])}</p><p>知情同意：{e(config['consent'])}</p><p>联系说明：{e(config['contact'])}</p></html>'''

    def get(self, handler, path):
        b = self.b
        if path == '/api/admin/research/assets':
            return self.assets()
        if path == '/api/admin/research/assets/export':
            rows = self.assets()['assets']
            headers = ['image','name','source','location','captured','heading','tags','note','archived','uses_in_drafts','created','updated']
            data = write_csv(headers, [[','.join(a[k]) if k == 'tags' else a[k] for k in headers] for a in rows], b.safe_csv)
            handler.send(data, kind='text/csv; charset=utf-8', filename='ridechoice-assets.csv')
            return None
        if path == '/api/admin/research/logs':
            with b.connect() as con:
                rows = con.execute('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').fetchall()
                return {'logs': [{**dict(r), 'details': json.loads(r['details'])} for r in rows]}
        if path == '/api/admin/research/logs/export':
            with b.connect() as con:
                rows = [dict(r) for r in con.execute('SELECT * FROM audit_log ORDER BY id')]
                self.audit(con, '导出操作日志', details={'rows': len(rows)})
            handler.send(write_csv(['id','created','action','subject','details'], [[r[k] for k in ('id','created','action','subject','details')] for r in rows], b.safe_csv),
                         kind='text/csv; charset=utf-8', filename='ridechoice-audit.csv')
            return None
        if m := re.fullmatch(r'/api/admin/research/versions/([a-zA-Z0-9_-]+)/(quality|analysis|report|sessions-export)', path):
            code, kind = m.groups()
            if kind == 'quality':
                params = parse_qs(urlparse(handler.path).query)
                threshold = float(params.get('fast_ms', ['1500'])[0])
                return self.quality(code, threshold)
            if kind == 'analysis':
                return self.analysis(code)
            if kind == 'sessions-export':
                handler.send(self.sessions_csv(code), kind='text/csv; charset=utf-8', filename=f'ridechoice-sessions-{code}.csv')
            else:
                report = self.report(code)
                with b.connect() as con:
                    self.audit(con, '导出实验报告', code)
                handler.send(report.encode('utf-8'), kind='text/html; charset=utf-8', filename=f'ridechoice-report-{code}.html')
            return None
        raise b.Problem('接口不存在', 404)

    def post(self, path, body):
        b = self.b
        if path == '/api/admin/research/assets/save':
            return self.save_asset(body)
        if path == '/api/admin/research/assets/archive':
            image = b.short(body.get('image', ''), 150)
            with b.connect() as con:
                b.require(con.execute('SELECT 1 FROM assets WHERE image=?', (image,)).fetchone(), '素材不存在', 404)
                con.execute('UPDATE assets SET archived=?,updated=? WHERE image=?', (int(body.get('archived') is True), b.now(), image))
                self.audit(con, '素材归档状态', image, {'archived': body.get('archived') is True})
            return {'ok': True}
        if path == '/api/admin/research/review':
            return self.save_review(body)
        if path == '/api/admin/research/design':
            return self.design(body)
        if path == '/api/admin/research/diagnostics':
            config = b.validate_config(body.get('config'))
            return self.design_diagnostics(config)
        raise b.Problem('接口不存在', 404)
