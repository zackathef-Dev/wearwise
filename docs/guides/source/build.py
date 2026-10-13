# usage: build.py <source.html> <out.pdf>   (see README.md in this folder)
# Two-pass HTML -> PDF with headless Chrome: pass 1 finds which page each section lands on,
# pass 2 fills the contents page; then page footers and metadata are added.
import html, io, os, re, shutil, subprocess, sys, tempfile
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
doc = open(src, encoding='utf-8').read()
# <!--INCLUDE-ESCAPED:path--> inlines a file (path relative to the HTML), HTML-escaped,
# so a document can quote a script from the repository without a copy that drifts.
doc = re.sub(r'<!--INCLUDE-ESCAPED:([^>]+?)-->',
             lambda m: html.escape(open(os.path.join(os.path.dirname(os.path.abspath(src)), m.group(1)),
                                        encoding='utf-8').read().rstrip('\n'), quote=False), doc)
title = re.search(r'data-doc="([^"]+)"', doc).group(1)
author_m = re.search(r'data-author="([^"]+)"', doc)
author = author_m.group(1) if author_m else 'WearWise Project Team'

# parts and sections, in document order
items = []
for m in re.finditer(r'<div class="part" data-part="([^"]+)">.*?<h2>(.*?)</h2>|<h3 id="([^"]+)"[^>]*><span class="num">([^<]+)</span>(.*?)</h3>', doc, re.S):
    if m.group(1):
        items.append(('part', m.group(1), re.sub('<[^>]+>', '', m.group(2))))
    else:
        items.append(('sec', m.group(3), m.group(4), re.sub('<[^>]+>', '', m.group(5))))

def toc(pages):
    rows = []
    for it in items:
        if it[0] == 'part':
            rows.append(f'<div class="part-row">{it[1]} · {it[2]}</div>')
        else:
            _, sid, num, text = it
            rows.append(f'<div class="row"><span class="n">{num}</span><span class="t">{text}</span>'
                        f'<span class="dots"></span><span class="pg">{pages.get(sid, "00")}</span></div>')
    return '\n  '.join(rows)

def render(page_numbers, markers, path_pdf):
    d = doc.replace('<!--TOC-->', toc(page_numbers))
    if markers:
        d = re.sub(r'(<h3 id="([^"]+)"[^>]*>)', lambda m: m.group(1) + f'<span class="marker">QQ{m.group(2).replace("-", "")}QQ</span>', d)
    tmp = os.path.join(HERE, '_build.html')
    open(tmp, 'w', encoding='utf-8').write(d)
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                    f'--user-data-dir={PROFILE}', '--virtual-time-budget=20000',
                    f'--print-to-pdf={path_pdf}', 'file://' + tmp],
                   check=True, capture_output=True)
    os.remove(tmp)

PROFILE = tempfile.mkdtemp(prefix='wearwise-pdf-chrome-')   # throwaway Chrome profile
p1 = os.path.join(HERE, '_pass1.pdf')
render({}, True, p1)
r = PdfReader(p1)
pages = {}
for i, pg in enumerate(r.pages):
    t = pg.extract_text() or ''
    for sid in re.findall(r'QQ([a-z]+)QQ', t):
        pages.setdefault(sid, i + 1)
pages = {it[1]: pages.get(it[1].replace('-', ''), '?') for it in items if it[0] == 'sec'}
missing = [k for k, v in pages.items() if v == '?']
if missing:
    print('WARNING: no page found for', missing)

p2 = os.path.join(HERE, '_pass2.pdf')
render(pages, False, p2)
r2 = PdfReader(p2)
n = len(r2.pages)
if n != len(r.pages):
    print(f'WARNING: page count changed between passes ({len(r.pages)} -> {n})')

w = PdfWriter()
for i, pg in enumerate(r2.pages):
    if i > 0:
        W, H = float(pg.mediabox.width), float(pg.mediabox.height)
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(W, H))
        c.setStrokeColor(HexColor('#DCE3EC')); c.setLineWidth(0.6)
        c.line(45, 36, W - 45, 36)
        c.setFont('Helvetica', 7.5); c.setFillColor(HexColor('#6B7A90'))
        c.drawString(45, 24, f'{title}  ·  handover release v1.0.0  ·  Research prototype, not a medical device')
        c.drawRightString(W - 45, 24, f'Page {i + 1} of {n}')
        c.save(); buf.seek(0)
        pg.merge_page(PdfReader(buf).pages[0])
    w.add_page(pg)
w.add_metadata({'/Title': title, '/Author': author,
                '/Subject': 'WearWise research prototype documentation', '/Creator': 'WearWise documentation'})
with open(out, 'wb') as f:
    w.write(f)
os.remove(p1); os.remove(p2)
shutil.rmtree(PROFILE, ignore_errors=True)
print(f'{out}: {n} pages; sections: ' + ', '.join(f'{k}={v}' for k, v in pages.items()))
