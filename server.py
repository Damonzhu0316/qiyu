"""骑遇骑行街景选择实验与偏好分析平台 V1.2 — local application server."""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import math
import mimetypes
import os
import random
import re
import secrets
import socket
import sqlite3
import tempfile
import time
import uuid
import webbrowser
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import research_tools
import annotation

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
DATA = Path(os.environ.get('RIDECHOICE_DATA', str(ROOT / 'data'))).resolve()
DB = DATA / 'experiments.sqlite3'
VERSION = '1.2.0'
PUBLIC_MODE = os.environ.get('RIDECHOICE_PUBLIC', '').strip().lower() in ('1', 'true', 'yes')
ADMIN_PASSWORD = os.environ.get('RIDECHOICE_ADMIN_PASSWORD', '')
ADMIN_SECRET = os.environ.get('RIDECHOICE_ADMIN_SECRET') or secrets.token_urlsafe(32)
MAX_BODY = 18 * 1024 * 1024

if PUBLIC_MODE and len(ADMIN_PASSWORD) < 12:
    raise RuntimeError('线上公开部署必须设置至少 12 位的 RIDECHOICE_ADMIN_PASSWORD')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def uid():
    return uuid.uuid4().hex


def encode(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


@contextmanager
def connect():
    con = sqlite3.connect(DB, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


class Problem(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def require(condition, message, status=400):
    if not condition:
        raise Problem(message, status)


def short(value, limit=500):
    require(isinstance(value, str), '文本字段格式不正确')
    require(len(value) <= limit, f'文本长度不能超过 {limit} 个字符')
    return value.strip()


def number(value, low, high, name):
    require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            and low <= value <= high, f'{name}应在 {low} 至 {high} 之间')
    return value


def local_asset(path):
    if re.fullmatch(r'/media/[a-f0-9]{64}\.(jpg|png|webp)', path):
        return DATA / 'uploads' / path.rsplit('/', 1)[1]
    if re.fullmatch(r'/demo/scene-[1-6]\.jpg', path):
        return WEB / path.lstrip('/')
    return None


def validate_config(obj):
    require(isinstance(obj, dict), '实验格式应为对象')
    obj = json.loads(encode(obj))
    obj['title'] = short(obj.get('title', ''), 100)
    require(obj['title'], '请填写实验名称')
    for key, default, length in [('description', '', 2000), ('context', '请想象你正独自骑行，天气适宜，两条路线均可通行。', 1000),
                                 ('consent', '我已阅读实验说明，理解参与完全自愿，同意匿名记录我的选择。', 2000),
                                 ('contact', '', 300)]:
        obj[key] = short(obj.get(key, default), length)
    for key in ('random_order', 'random_sides', 'allow_neither', 'show_feedback'):
        obj[key] = bool(obj.get(key, True))
    questions = obj.get('questions')
    require(isinstance(questions, list) and 1 <= len(questions) <= 100, '每个实验需要 1–100 道题')
    ids = set()
    for question in questions:
        require(isinstance(question, dict), '题目格式不正确')
        question['id'] = short(question.get('id') or uid(), 64)
        require(question['id'] not in ids, '题目编号不能重复')
        ids.add(question['id'])
        question['prompt'] = short(question.get('prompt', '你更愿意选择哪条路线？'), 300)
        require(question['prompt'], '题目提问不能为空')
        question['context'] = short(question.get('context', ''), 1000)
        for key in ('a', 'b'):
            alt = question.get(key)
            require(isinstance(alt, dict), '每道题需要两条路线')
            alt['time'] = number(alt.get('time'), 1, 240, '骑行时间')
            stops = number(alt.get('stops', 0), 0, 30, '信号灯数量')
            require(stops == int(stops), '信号灯数量应为整数')
            alt['stops'] = int(stops)
            for field, limit in [('image', 150), ('facility', 100), ('source', 500), ('captured', 50),
                                 ('location', 150), ('heading', 100)]:
                alt[field] = short(alt.get(field, ''), limit)
            if alt['image']:
                asset = local_asset(alt['image'])
                require(asset is not None and asset.is_file(), '图片不存在，请重新上传')
    return research_tools.normalize_config(obj, require, number, short)


def publication_errors(config):
    errors = []
    if not config['description']:
        errors.append('请补充参与说明（研究用途、退出方式与数据用途）')
    if not config['consent']:
        errors.append('请填写知情同意说明')
    for i, q in enumerate(config['questions'], 1):
        for key in ('a', 'b'):
            a = q[key]
            label = f'第 {i} 题路线 {key.upper()}'
            if not a['image'] or a['image'].startswith('/demo/'):
                errors.append(f'{label}：请导入正式实验图片')
            if not a['source']:
                errors.append(f'{label}：请记录图片来源及使用依据')
            if not a['location'] or not a['captured'] or not a['heading']:
                errors.append(f'{label}：请补全地点、拍摄日期及视角（未知时请明确填写“未知”）')
        if q['a']['image'] and q['a']['image'] == q['b']['image']:
            errors.append(f'第 {i} 题：两条路线使用了相同图片，请核查实验设计')
    return errors


def demo_config():
    pairs = [(1, 3, 15, 18), (3, 2, 18, 22), (4, 1, 16, 20),
             (5, 6, 20, 24), (2, 5, 15, 21), (6, 4, 22, 22)]
    questions = []
    for i, (a, b, ta, tb) in enumerate(pairs, 1):
        q = {'id': f'demo-{i}', 'prompt': '你更愿意选择哪条路线？', 'context': ''}
        for k, scene, minutes in [('a', a, ta), ('b', b, tb)]:
            q[k] = {'image': f'/demo/scene-{scene}.jpg', 'time': minutes, 'stops': (i + (k == 'b')) % 3,
                    'facility': '请结合画面判断', 'source': '既有本地街景副本；仅供本地演示，正式使用前需核实使用权限',
                    'location': '本地街景示例，未核验位置', 'captured': '未知', 'heading': '沿道路方向，未独立核验'}
        questions.append(q)
    return validate_config({'title': '你愿意多骑几分钟？', 'description': '比较两条路线的街景与骑行时间，选择你更愿意走的一条。共 6 题，不收集姓名和联系方式。可随时关闭页面退出；未完成记录会单独标记。本演示的时间、信号灯均为假设条件，不代表图片所在地的实际路线。',
                            'context': '想象这是一次日常骑行：天气适宜，你独自出行。两条路线起终点相同、均可通行，除展示条件外其余情况相近。',
                            'consent': '我已阅读说明，知道这是演示实验，愿意匿名记录本次选择。我可以随时退出。',
                            'contact': '正式实验请由研究者补充联系渠道与研究说明。',
                            'random_order': True, 'random_sides': True, 'allow_neither': True,
                            'show_feedback': True, 'questions': questions})


def init():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'uploads').mkdir(exist_ok=True)
    with connect() as con:
        con.executescript('''PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY, config TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS versions(code TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id),
          number INTEGER NOT NULL, config TEXT NOT NULL, demo INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES versions(code),
          profile TEXT NOT NULL, plan TEXT NOT NULL, seed TEXT NOT NULL, preview INTEGER NOT NULL, consent TEXT NOT NULL,
          created TEXT NOT NULL, finished TEXT, current_issued REAL);
        CREATE TABLE IF NOT EXISTS answers(session_id TEXT NOT NULL REFERENCES sessions(id), question_id TEXT NOT NULL,
          position INTEGER NOT NULL, choice TEXT NOT NULL, side TEXT NOT NULL, elapsed_ms INTEGER NOT NULL,
          active_ms INTEGER, hidden_count INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL, confidence TEXT NOT NULL,
          created TEXT NOT NULL, PRIMARY KEY(session_id, question_id), UNIQUE(session_id,position));
        CREATE INDEX IF NOT EXISTS sessions_code ON sessions(code);''')
        if not con.execute('SELECT 1 FROM versions WHERE code=?', ('demo',)).fetchone():
            config = encode(demo_config())
            con.execute('INSERT INTO experiments VALUES(?,?,?,?)', ('example', config, now(), now()))
            con.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?)', ('demo', 'example', 1, config, 1, 1, now()))
        research_api().migrate(con)
        annotation_api().migrate(con)
    annotation_api().seed_demo_projects()


def get_version(con, code, active=False):
    row = con.execute('SELECT * FROM versions WHERE code=?', (code,)).fetchone()
    require(row, '实验不存在，请检查链接', 404)
    if active:
        require(row['active'], '这个实验已停止接收回答', 409)
    return row


def public_config(row):
    config = json.loads(row['config'])
    block_count = config.get('block_count', 1)
    sizes = [sum(q.get('block', 1) == group for q in config['questions']) for group in range(1, block_count + 1)]
    return {'code': row['code'], 'title': config['title'], 'description': config['description'],
            'context': config['context'], 'consent': config['consent'], 'contact': config['contact'],
            'count': len(config['questions']), 'demo': bool(row['demo']), 'active': bool(row['active']),
            'version': row['number'], 'allow_neither': config['allow_neither'], 'show_feedback': config['show_feedback'],
            'block_count': block_count, 'count_min': min(sizes), 'count_max': max(sizes)}


def session_state(con, session_id, issue=True):
    session = con.execute('SELECT * FROM sessions WHERE id=?', (session_id,)).fetchone()
    require(session, '本次作答不存在，请重新进入实验', 404)
    version = get_version(con, session['code'])
    config = json.loads(version['config'])
    answers = con.execute('SELECT * FROM answers WHERE session_id=? ORDER BY position', (session_id,)).fetchall()
    plan = json.loads(session['plan'])
    state = {'id': session_id, 'experiment': public_config(version), 'done': len(answers), 'total': len(plan),
             'complete': bool(session['finished']), 'preview': bool(session['preview']), 'block_index': session['block_index']}
    if session['finished']:
        if config['show_feedback']:
            questions = {q['id']: q for q in config['questions']}
            longer, shorter, equal, neither = 0, 0, 0, 0
            extra = []
            for answer in answers:
                if answer['choice'] == 'neither':
                    neither += 1
                    continue
                q = questions[answer['question_id']]
                chosen = q[answer['choice']]['time']
                other = q['b' if answer['choice'] == 'a' else 'a']['time']
                if chosen > other:
                    longer += 1
                    extra.append(chosen - other)
                elif chosen < other:
                    shorter += 1
                else:
                    equal += 1
            state['feedback'] = {'longer': longer, 'shorter': shorter, 'equal': equal, 'neither': neither,
                                 'extra_minutes': extra, 'answered': len(answers)}
        return state
    require(version['active'], '实验已停止接收回答，你的已有记录已保留', 409)
    item = plan[len(answers)]
    q = next(q for q in config['questions'] if q['id'] == item['id'])
    if issue and session['current_issued'] is None:
        con.execute('UPDATE sessions SET current_issued=? WHERE id=?', (time.time(), session_id))
    # Display labels contain no canonical IDs. Analysis retains mapping in the database.
    def visible_alt(alt):
        return {key: alt[key] for key in ('image', 'time', 'stops', 'facility')}
    state['question'] = {'id': q['id'], 'prompt': q['prompt'], 'context': q['context'] or config['context'],
                         'left': visible_alt(q['b' if item['swap'] else 'a']),
                         'right': visible_alt(q['a' if item['swap'] else 'b'])}
    return state


def start_session(body, preview=False, nickname=''):
    code = short(body.get('code', ''), 40)
    require(body.get('consent') is True, '请先阅读说明并同意参与')
    profile = body.get('profile', {})
    require(isinstance(profile, dict), '参与信息格式不正确')
    profile = {k: short(profile.get(k, ''), 80) for k in ('frequency', 'purpose', 'experience', 'participant_code')}
    profile['nickname'] = short(nickname, 40)
    require(profile['frequency'] in ('几乎不骑', '每月几次', '每周1–2次', '每周3次及以上'), '请选择骑行频率')
    require(profile['purpose'] in ('通勤通学', '日常办事', '休闲游览', '运动锻炼', '其他'), '请选择骑行目的')
    require(profile['experience'] in ('新手', '有一定经验', '经验丰富'), '请选择骑行经验')
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        v = get_version(con, code, active=True)
        c = json.loads(v['config'])
        seed = secrets.token_hex(16)
        rng = random.Random(seed)
        blocks = c.get('block_count', 1)
        assigned = con.execute('SELECT COUNT(*) FROM sessions WHERE code=? AND preview=?', (code, int(preview))).fetchone()[0] % blocks + 1
        group_questions = [q for q in c['questions'] if q.get('block', 1) == assigned]
        require(group_questions, '所分配题组没有题目，请联系研究者', 409)
        plan = [{'id': q['id'], 'swap': rng.choice([True, False]) if c['random_sides'] else False} for q in group_questions]
        if c['random_order']:
            rng.shuffle(plan)
        sid = secrets.token_urlsafe(32)
        con.execute('''INSERT INTO sessions(id,code,profile,plan,seed,preview,consent,created,finished,current_issued,block_index)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)''',
                    (sid, code, encode(profile), encode(plan), seed, int(preview), c['consent'], now(), None, None, assigned))
        return session_state(con, sid)


def answer_session(sid, body):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        s = con.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
        require(s, '本次作答不存在', 404)
        qid = short(body.get('question_id', ''), 64)
        side = body.get('side')
        require(side in ('left', 'right', 'neither'), '请选择一条路线')
        existing = con.execute('SELECT side FROM answers WHERE session_id=? AND question_id=?', (sid, qid)).fetchone()
        if existing:
            require(existing['side'] == side, '这道题已经提交，不能重复修改', 409)
            return session_state(con, sid)
        v = get_version(con, s['code'], active=True)
        config = json.loads(v['config'])
        require(side != 'neither' or config['allow_neither'], '本实验未开放“都不选”选项')
        count = con.execute('SELECT COUNT(*) FROM answers WHERE session_id=?', (sid,)).fetchone()[0]
        plan = json.loads(s['plan'])
        require(not s['finished'] and count < len(plan), '本次作答已完成', 409)
        item = plan[count]
        require(item['id'] == qid and s['current_issued'] is not None, '题目顺序已变化，请刷新后继续', 409)
        choice = 'neither' if side == 'neither' else ('b' if (side == 'left') == item['swap'] else 'a')
        elapsed = max(0, round((time.time() - s['current_issued']) * 1000))
        active = body.get('active_ms')
        if active is not None:
            active = int(number(active, 0, 604800000, '页面可见时长'))
        hidden = int(number(body.get('hidden_count', 0), 0, 100000, '页面切换次数'))
        confidence = short(body.get('confidence', ''), 20)
        require(confidence in ('', '不太确定', '比较确定', '非常确定'), '确定程度格式不正确')
        reason = short(body.get('reason', ''), 500)
        con.execute('INSERT INTO answers VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                    (sid, qid, count + 1, choice, side, elapsed, active, hidden, reason, confidence, now()))
        con.execute('UPDATE sessions SET current_issued=NULL, finished=? WHERE id=?',
                    (now() if count + 1 == len(plan) else None, sid))
        return session_state(con, sid)


def admin_summary():
    with connect() as con:
        items = []
        for e in con.execute('SELECT * FROM experiments ORDER BY updated DESC'):
            versions = []
            for v in con.execute('SELECT * FROM versions WHERE experiment_id=? ORDER BY number DESC', (e['id'],)):
                counts = con.execute('SELECT COUNT(*) total, SUM(finished IS NOT NULL) complete FROM sessions WHERE code=? AND preview=0', (v['code'],)).fetchone()
                versions.append({'code': v['code'], 'number': v['number'], 'demo': bool(v['demo']), 'active': bool(v['active']),
                                 'created': v['created'], 'total': counts['total'], 'complete': counts['complete'] or 0})
            config = json.loads(e['config'])
            items.append({'id': e['id'], 'config': config, 'updated': e['updated'], 'versions': versions,
                          'checks': publication_errors(config)})
        return {'experiments': items, 'version': VERSION, 'software_name': research_tools.SOFTWARE_NAME,
                'asset_count': con.execute('SELECT COUNT(*) FROM assets WHERE archived=0').fetchone()[0]}


def stats(code):
    with connect() as con:
        v = get_version(con, code)
        c = json.loads(v['config'])
        sessions = con.execute('SELECT * FROM sessions WHERE code=? AND preview=0', (code,)).fetchall()
        complete = [s for s in sessions if s['finished']]
        answers = con.execute('''SELECT a.* FROM answers a JOIN sessions s ON s.id=a.session_id
            LEFT JOIN reviews r ON r.session_id=s.id WHERE s.code=? AND s.preview=0 AND s.finished IS NOT NULL
            AND COALESCE(r.status,'pending')!='exclude' ''', (code,)).fetchall()
        by_question = []
        for q in c['questions']:
            rows = [a for a in answers if a['question_id'] == q['id']]
            by_question.append({'id': q['id'], 'a': sum(a['choice'] == 'a' for a in rows),
                                'b': sum(a['choice'] == 'b' for a in rows), 'neither': sum(a['choice'] == 'neither' for a in rows),
                                'n': len(rows), 'time_a': q['a']['time'], 'time_b': q['b']['time']})
        return {'experiment': public_config(v), 'started': len(sessions), 'completed': len(complete),
                'incomplete': len(sessions) - len(complete), 'answers': len(answers), 'questions': by_question}


def safe_csv(value):
    # Prevent user text from becoming spreadsheet formulas, preserve numeric types.
    if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')):
        return "'" + value
    return value


def export_csv(code):
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    headers = ['session_id', 'experiment_code', 'version', 'is_demo', 'is_preview', 'completed', 'started_at_utc',
               'finished_at_utc', 'volunteer_nickname', 'frequency', 'purpose', 'experience', 'participant_code', 'random_seed',
               'question_id', 'display_order', 'swapped', 'choice_canonical', 'choice_display',
               'elapsed_ms_server', 'visible_ms_client', 'hidden_count_client', 'reason', 'confidence', 'answered_at_utc',
               'time_a_min', 'time_b_min', 'stops_a', 'stops_b', 'facility_a', 'facility_b',
               'image_a', 'image_b', 'source_a', 'source_b', 'location_a', 'location_b', 'captured_a', 'captured_b', 'heading_a', 'heading_b',
               'context', 'consent_text', 'config_sha256', 'block_index', 'review_status', 'review_note', 'reviewed_at_utc']
    writer.writerow(headers)
    with connect() as con:
        v = get_version(con, code)
        config = json.loads(v['config'])
        questions = {q['id']: q for q in config['questions']}
        digest = hashlib.sha256(v['config'].encode()).hexdigest()
        for s in con.execute('SELECT * FROM sessions WHERE code=? ORDER BY created', (code,)):
            profile = json.loads(s['profile'])
            plan = {p['id']: p for p in json.loads(s['plan'])}
            rows = con.execute('SELECT * FROM answers WHERE session_id=? ORDER BY position', (s['id'],)).fetchall()
            for a in rows:
                q = questions[a['question_id']]
                values = [s['id'], code, v['number'], v['demo'], s['preview'], int(bool(s['finished'])), s['created'], s['finished'] or '',
                          profile.get('nickname', ''), *[profile[k] for k in ('frequency', 'purpose', 'experience', 'participant_code')], s['seed'],
                          a['question_id'], a['position'], int(plan[a['question_id']]['swap']), a['choice'], a['side'],
                          a['elapsed_ms'], a['active_ms'] if a['active_ms'] is not None else '', a['hidden_count'],
                          a['reason'], a['confidence'], a['created']]
                for field in ('time', 'stops', 'facility', 'image', 'source', 'location', 'captured', 'heading'):
                    values.extend([q['a'][field], q['b'][field]])
                values.extend([q['context'] or config['context'], s['consent'], digest])
                review = con.execute('SELECT * FROM reviews WHERE session_id=?', (s['id'],)).fetchone()
                values.extend([s['block_index'], review['status'] if review else 'pending', review['note'] if review else '', review['updated'] if review else ''])
                writer.writerow([safe_csv(x) for x in values])
    return ('\ufeff' + output.getvalue()).encode('utf-8')


def research_api():
    return research_tools.ResearchTools(connect=connect, now=now, uid=uid, encode=encode,
        require=require, short=short, number=number, Problem=Problem, local_asset=local_asset,
        get_version=get_version, public_config=public_config, validate_config=validate_config,
        stats=stats, safe_csv=safe_csv, DATA=DATA, ROOT=ROOT, VERSION=VERSION)


def annotation_api():
    return annotation.AnnotationTools(connect=connect, now=now, uid=uid, encode=encode,
        require=require, short=short, Problem=Problem, local_asset=local_asset,
        audit=lambda con, action, subject='', details=None: research_api().audit(con, action, subject, details),
        hashlib=hashlib, secrets=secrets, safe_csv=safe_csv)


class Handler(BaseHTTPRequestHandler):
    server_version = 'RideChoice/' + VERSION

    def log_message(self, fmt, *args):
        # Session tokens are bearer secrets: never write URL paths to logs.
        if args and str(args[1] if len(args) > 1 else '').startswith('5'):
            print('Request failed', flush=True)

    def guard(self, mutation=False):
        host = self.headers.get('Host', '').split(':')[0].lower()
        allowed = {'127.0.0.1', 'localhost', socket.gethostname().lower(), *self.server.allowed_hosts}
        require(PUBLIC_MODE or host in allowed, '主机地址未获允许', 403)
        if mutation:
            origin = self.headers.get('Origin')
            require(not origin or urlparse(origin).netloc == self.headers.get('Host'), '请求来源不匹配', 403)
            require(self.headers.get('Sec-Fetch-Site') not in ('cross-site',), '不接受跨站请求', 403)

    def admin(self):
        require(PUBLIC_MODE or self.client_address[0] in ('127.0.0.1', '::1'), '研究者管理仅允许在运行平台的电脑上打开', 403)
        identity = annotation_api().authenticate(self)
        require(identity and identity['role'] == 'manager', '请先以管理人员身份登录', 401)
        cookie = self.headers.get('Cookie', '')
        token = next((p.strip()[len('ride_admin='):] for p in cookie.split(';') if p.strip().startswith('ride_admin=')), '')
        require(secrets.compare_digest(token, ADMIN_SECRET), '请重新打开研究者工作台', 401)

    def volunteer(self):
        identity = annotation_api().authenticate(self)
        require(identity and identity['role'] == 'volunteer', '请先以志愿者身份登录', 401)
        return identity

    def send(self, body, status=200, kind='application/json; charset=utf-8', filename=None, cookie=None):
        is_file = isinstance(body, Path)
        if not isinstance(body, bytes) and not is_file:
            body = encode(body).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(body.stat().st_size if is_file else len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        if is_file:
            import shutil
            with body.open('rb') as stream:
                shutil.copyfileobj(stream, self.wfile, 256 * 1024)
        else:
            self.wfile.write(body)

    def body(self):
        length = int(self.headers.get('Content-Length', '0'))
        require(0 < length <= MAX_BODY, '请求内容过大或为空', 413)
        require(self.headers.get('Content-Type', '').split(';')[0] == 'application/json', '请使用 JSON 格式', 415)
        return json.loads(self.rfile.read(length))

    def run_route(self, mutation=False):
        try:
            self.guard(mutation)
            path = unquote(urlparse(self.path).path)
            result = self.route_post(path, self.body()) if mutation else self.route_get(path)
            if result is not None:
                self.send(result)
        except Problem as exc:
            self.send({'error': exc.message}, exc.status)
        except (ValueError, TypeError, KeyError, OverflowError, AttributeError):
            self.send({'error': '数据格式不正确，请检查后重试'}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            import traceback
            traceback.print_exc()
            self.send({'error': '保存失败，已有数据已保留，请重试'}, 500)

    def do_GET(self):
        self.run_route()

    def do_POST(self):
        self.run_route(True)

    def route_get(self, path):
        if path == '/api/health':
            return {'ok': True, 'app': 'RideChoice', 'version': VERSION, 'host': self.server.server_address[0]}
        if path == '/api/identity':
            identity = annotation_api().authenticate(self)
            require(identity, '请先登录', 401)
            return identity
        if path == '/api/admin/bootstrap':
            require(PUBLIC_MODE or self.client_address[0] in ('127.0.0.1', '::1'), '研究者管理仅限本机', 403)
            require(self.headers.get('Sec-Fetch-Site') not in ('cross-site',), '请求来源不匹配', 403)
            identity = annotation_api().authenticate(self)
            require(identity and identity['role'] == 'manager', '请先以管理人员身份登录', 401)
            secure = '; Secure' if PUBLIC_MODE or self.headers.get('X-Forwarded-Proto') == 'https' else ''
            self.send({'ok': True}, cookie=f'ride_admin={ADMIN_SECRET}; HttpOnly; SameSite=Strict; Path=/{secure}')
            return
        if path == '/api/admin':
            self.admin()
            return admin_summary()
        if path.startswith('/api/admin/research/'):
            self.admin()
            return research_api().get(self, path)
        if path == '/api/admin/annotations':
            self.admin()
            return annotation_api().manager_projects()
        if m := re.fullmatch(r'/api/admin/annotations/([a-f0-9]{32})/answers', path):
            self.admin()
            page = int(parse_qs(urlparse(self.path).query).get('page', ['1'])[0])
            return annotation_api().view_answers(m[1], page)
        if m := re.fullmatch(r'/api/admin/annotations/([a-f0-9]{32})/export', path):
            self.admin()
            self.send(annotation_api().export(m[1]), kind='text/csv; charset=utf-8', filename=f'ridechoice-annotation-{m[1][:8]}.csv')
            return
        if path == '/api/volunteer/tasks':
            self.volunteer()
            return annotation_api().task_list(parse_qs(urlparse(self.path).query).get('mode', [''])[0])
        if m := re.fullmatch(r'/api/volunteer/projects/([a-f0-9]{32})', path):
            self.volunteer()
            return annotation_api().public_project(m[1])
        if m := re.fullmatch(r'/api/annotation/sessions/([a-f0-9]{32})', path):
            return annotation_api().state(m[1], self.volunteer())
        if path == '/api/admin/backup':
            self.admin()
            # SQLite backup API takes a consistent snapshot, including WAL transactions.
            with tempfile.TemporaryDirectory(prefix='backup-', dir=DATA) as folder:
                folder = Path(folder)
                snapshot = folder / 'experiments.sqlite3'
                with connect() as source:
                    destination = sqlite3.connect(snapshot)
                    try:
                        source.backup(destination)
                    finally:
                        destination.close()
                archive = folder / 'ridechoice-backup.zip'
                with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
                    z.write(snapshot, 'data/experiments.sqlite3')
                    for file in (DATA / 'uploads').iterdir():
                        if file.is_file() and file.suffix in ('.jpg', '.png', '.webp'):
                            z.write(file, 'data/uploads/' + file.name)
                    for file in WEB.rglob('*'):
                        if file.is_file():
                            z.write(file, file.relative_to(ROOT).as_posix())
                    for file in (ROOT / 'tests').glob('*.py'):
                        z.write(file, file.relative_to(ROOT).as_posix())
                    for file in ROOT.iterdir():
                        if file.is_file() and file.suffix in ('.py', '.md', '.bat', '.ps1', '.json'):
                            z.write(file, file.name)
                self.send(archive, kind='application/zip', filename='ridechoice-full-backup.zip')
            return
        if m := re.fullmatch(r'/api/admin/versions/([a-zA-Z0-9_-]+)/(stats|export|snapshot|sessions)', path):
            self.admin()
            code, kind = m.groups()
            if kind == 'stats':
                return stats(code)
            if kind == 'export':
                self.send(export_csv(code), kind='text/csv; charset=utf-8', filename=f'ridechoice-{code}.csv')
            elif kind == 'snapshot':
                with connect() as con:
                    v = get_version(con, code)
                    self.send({'schema': 'ridechoice-v1', 'code': code, 'version': v['number'],
                               'demo': bool(v['demo']), 'created': v['created'], 'config': json.loads(v['config'])}, filename=f'ridechoice-{code}.json')
            else:
                with connect() as con:
                    get_version(con, code)
                    rows = con.execute('''SELECT s.id,s.profile,s.preview,s.created,s.finished,s.block_index,s.plan,
                        COALESCE(r.status,'pending') review_status,COUNT(a.question_id) answered FROM sessions s
                        LEFT JOIN answers a ON a.session_id=s.id LEFT JOIN reviews r ON r.session_id=s.id
                        WHERE s.code=? GROUP BY s.id ORDER BY s.created DESC''', (code,)).fetchall()
                    return {'sessions': [{**{k:r[k] for k in r.keys() if k!='plan'}, 'total':len(json.loads(r['plan'])), 'profile': json.loads(r['profile'])} for r in rows]}
            return
        if m := re.fullmatch(r'/api/experiments/([a-zA-Z0-9_-]+)', path):
            with connect() as con:
                return public_config(get_version(con, m[1]))
        if m := re.fullmatch(r'/api/sessions/([a-zA-Z0-9_-]+)', path):
            with connect() as con:
                session = con.execute('SELECT * FROM sessions WHERE id=?', (m[1],)).fetchone()
                require(session, '本次作答不存在，请重新进入实验', 404)
                if session['preview']:
                    self.admin()
                else:
                    identity = self.volunteer()
                    require(json.loads(session['profile']).get('nickname') == identity['nickname'], '这条作答记录属于另一位志愿者', 403)
                return session_state(con, m[1])
        if path.startswith('/api/'):
            raise Problem('接口不存在', 404)
        if path.startswith('/media/'):
            file = local_asset(path)
        elif path in ('/', '/admin', '/volunteer') or path.startswith(('/p/', '/annotation/')):
            file = WEB / 'index.html'
        else:
            file = (WEB / path.lstrip('/')).resolve()
            require(file.is_relative_to(WEB.resolve()), '路径无效', 403)
        require(file is not None and file.is_file(), '文件不存在', 404)
        self.send(file.read_bytes(), kind=mimetypes.guess_type(str(file))[0] or 'application/octet-stream')

    def route_post(self, path, body):
        require(isinstance(body, dict), '请求格式不正确')
        if path == '/api/login':
            if PUBLIC_MODE and body.get('role') == 'manager':
                provided = body.get('manager_password', '')
                require(isinstance(provided, str) and secrets.compare_digest(provided, ADMIN_PASSWORD),
                        '管理人员口令不正确', 403)
            result = annotation_api().login(body)
            token = result.pop('token')
            secure = '; Secure' if PUBLIC_MODE or self.headers.get('X-Forwarded-Proto') == 'https' else ''
            self.send(result, cookie=f'ride_role={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000{secure}')
            return
        if path == '/api/logout':
            identity = annotation_api().authenticate(self)
            if identity:
                token = next((p.strip()[len('ride_role='):] for p in self.headers.get('Cookie', '').split(';') if p.strip().startswith('ride_role=')), '')
                digest = hashlib.sha256(token.encode()).hexdigest()
                with connect() as con:
                    con.execute('DELETE FROM identities WHERE token_hash=?', (digest,))
            secure = '; Secure' if PUBLIC_MODE or self.headers.get('X-Forwarded-Proto') == 'https' else ''
            self.send({'ok': True}, cookie=f'ride_role=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{secure}')
            return
        if path == '/api/admin/annotations':
            self.admin()
            return annotation_api().create_project(body)
        if m := re.fullmatch(r'/api/admin/annotations/([a-f0-9]{32})/status', path):
            self.admin()
            return annotation_api().project_status(m[1], body.get('published') is True)
        if path == '/api/annotation/sessions':
            return annotation_api().start(short(body.get('project_id', ''), 40), body.get('consent') is True, self.volunteer())
        if m := re.fullmatch(r'/api/annotation/sessions/([a-f0-9]{32})/answer', path):
            return annotation_api().answer(m[1], body, self.volunteer())
        if path == '/api/sessions':
            preview = body.get('preview') is True
            if preview:
                self.admin()
                return start_session(body, preview)
            identity = self.volunteer()
            return start_session(body, False, identity['nickname'])
        if m := re.fullmatch(r'/api/sessions/([a-zA-Z0-9_-]+)/answer', path):
            identity = self.volunteer()
            with connect() as con:
                session = con.execute('SELECT profile FROM sessions WHERE id=?', (m[1],)).fetchone()
                require(session, '本次作答不存在', 404)
                require(json.loads(session['profile']).get('nickname') == identity['nickname'], '这条作答记录属于另一位志愿者', 403)
            return answer_session(m[1], body)
        if path.startswith('/api/admin/'):
            self.admin()
            if path.startswith('/api/admin/research/'):
                return research_api().post(path, body)
            if path == '/api/admin/save':
                config = validate_config(body.get('config'))
                eid = short(body.get('id') or uid(), 64)
                require(re.fullmatch('[a-zA-Z0-9_-]+', eid), '实验编号无效')
                with connect() as con:
                    con.execute('INSERT INTO experiments VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,updated=excluded.updated',
                                (eid, encode(config), now(), now()))
                    research_api().audit(con, '保存实验草稿', eid, {'title': config['title'], 'questions': len(config['questions']), 'blocks':config['block_count']})
                return {'id': eid}
            if path == '/api/admin/publish':
                eid = short(body.get('id', ''), 64)
                demo = body.get('demo') is True
                require(demo or body.get('reviewed') is True, '请先确认图片使用依据与实验设计')
                with connect() as con:
                    con.execute('BEGIN IMMEDIATE')
                    e = con.execute('SELECT config FROM experiments WHERE id=?', (eid,)).fetchone()
                    require(e, '请先保存草稿', 404)
                    config = validate_config(json.loads(e['config']))
                    errors = publication_errors(config)
                    require(demo or not errors, '发布检查未通过：' + '；'.join(errors[:6]))
                    num = con.execute('SELECT COALESCE(MAX(number),0)+1 FROM versions WHERE experiment_id=?', (eid,)).fetchone()[0]
                    code = secrets.token_hex(6)
                    con.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?)', (code, eid, num, encode(config), int(demo), 1, now()))
                    research_api().audit(con, '发布实验版本', code, {'number': num, 'demo':demo, 'title':config['title']})
                return {'code': code, 'number': num, 'demo': demo}
            if path == '/api/admin/active':
                with connect() as con:
                    get_version(con, short(body.get('code', ''), 40))
                    con.execute('UPDATE versions SET active=? WHERE code=?', (int(body.get('active') is True), body['code']))
                    research_api().audit(con, '调整接收状态', body['code'], {'active':body.get('active') is True})
                return {'ok': True}
            if path == '/api/admin/upload':
                raw = body.get('data', '')
                require(isinstance(raw, str) and len(raw) < MAX_BODY, '图片过大')
                payload = base64.b64decode(raw, validate=True)
                require(0 < len(payload) <= 12 * 1024 * 1024, '单张图片不能超过 12 MB')
                ext = 'jpg' if payload.startswith(b'\xff\xd8\xff') else 'png' if payload.startswith(b'\x89PNG\r\n\x1a\n') else 'webp' if payload[:4] == b'RIFF' and payload[8:12] == b'WEBP' else None
                require(ext, '请选择 JPG、PNG 或 WebP 图片')
                name = hashlib.sha256(payload).hexdigest() + '.' + ext
                target = DATA / 'uploads' / name
                if not target.exists():
                    temp = target.with_suffix('.' + uid() + '.tmp')
                    temp.write_bytes(payload)
                    temp.replace(target)
                display_name = short(body.get('name', ''), 200)
                with connect() as con:
                    research_api().register_asset(con, '/media/' + name, display_name)
                    research_api().audit(con, '导入街景素材', '/media/' + name, {'name':display_name})
                return {'image': '/media/' + name, 'name': display_name}
        raise Problem('接口不存在', 404)


def main():
    parser = argparse.ArgumentParser(description='RideChoice 街景选择实验平台')
    parser.add_argument('--host', default=os.environ.get('HOST', '0.0.0.0' if PUBLIC_MODE else '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '8896')))
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    init()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    server.allowed_hosts = {args.host}
    try:
        server.allowed_hosts.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    url = f'http://127.0.0.1:{args.port}'
    print(f'RideChoice {VERSION}\nLocal: {url}\nResearcher: {url}/admin\nDemo: {url}/p/demo', flush=True)
    if args.host == '0.0.0.0':
        print('Public web access enabled.' if PUBLIC_MODE else 'LAN participant access enabled. Researcher management remains local-only.', flush=True)
    if args.open:
        webbrowser.open(url + '/admin')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
