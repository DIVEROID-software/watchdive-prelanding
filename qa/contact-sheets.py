from PIL import Image, ImageDraw
from pathlib import Path
for locale in ['ko','en']:
 for kind in ['guide','notice3','notice10']:
  base=f'guide-{locale}' if kind=='guide' else f'notice-{locale}-{kind[6:]}'
  paths=[Path(f'qa/{base}-{w}-{mode}.png') for w in [375,600] for mode in ['light','dark']]
  imgs=[Image.open(p) for p in paths]
  out=Image.new('RGB',(sum(i.width for i in imgs),max(i.height for i in imgs)+28),'#dddddd');draw=ImageDraw.Draw(out);x=0
  for p,i in zip(paths,imgs):
   out.paste(i,(x,28));draw.text((x+5,5),p.name,fill='black');x+=i.width
  out.save(f'qa/review-{base}.png')
 for suffix in ['', '-open']:
  imgs=[Image.open(f'qa/site-{locale}-{n}-390{suffix}.png') for n in [3,10]]
  out=Image.new('RGB',(780,max(i.height for i in imgs)+28),'#ddd');draw=ImageDraw.Draw(out)
  for x,i in enumerate(imgs):
   out.paste(i,(x*390,28));draw.text((x*390+5,5),f'{locale} count={[3,10][x]} {suffix}',fill='black')
  out.save(f'qa/review-site-{locale}{suffix}.png')
