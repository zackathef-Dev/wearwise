# usage: pages.py <pdf> <outprefix> [per_sheet=6]
import sys, pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont
pdf = pdfium.PdfDocument(sys.argv[1]); per = int(sys.argv[3]) if len(sys.argv) > 3 else 6
imgs = [pdf[i].render(scale=0.9).to_pil().convert('RGB') for i in range(len(pdf))]
w, h = imgs[0].size; cols = 3
for s in range(0, len(imgs), per):
    grp = imgs[s:s + per]; rows = (len(grp) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * w + (cols + 1) * 16, rows * (h + 40) + 16), (120, 120, 120))
    d = ImageDraw.Draw(sheet)
    for k, im in enumerate(grp):
        x = 16 + (k % cols) * (w + 16); y = 16 + (k // cols) * (h + 40)
        sheet.paste(im, (x, y + 24)); d.text((x, y), f'page {s + k + 1}', fill='white', font=ImageFont.load_default(size=20))
    sheet.save(f'{sys.argv[2]}-{s // per + 1}.png')
print(len(imgs), 'pages', w, h)
