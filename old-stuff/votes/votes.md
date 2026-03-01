import requests
import re
import matplotlib.pyplot as plt
from matplotlib.pyplot import figure

url = 'https://raw.githubusercontent.com/alex/nyt-2020-election-scraper/master/battleground-state-changes.txt'
r = requests.get(url, allow_redirects=True)
data = r.text

def plot(f, subtitle):
  s = data.find(f, 0)

  g = data[s:]
  lines = g.splitlines()

  dates = []
  diffs = []
  rems = []
  for line in lines:
    if (line.startswith("2020")):
      res = re.search("(2020.*\d).*leading by (.*) votes.*\(est.\): (.*)(\s*)Change", line)
      date = res.group(1)
      diff = res.group(2)
      rem = res.group(3)
      dates.append(date[11:])
      diffs.append(int(diff.replace(",","")))
      rems.append(int(rem.replace(",","")))
    elif not line.strip():
      break

  diffs = diffs[::-1]
  dates = dates[::-1]
  rems = rems[::-1]

  title = f + " " + subtitle + "\nlast update: " + dates[-1] + " UTC\n" + str(diffs[-1]) + " votes\nremaining: " + str(rems[-1])
  return (diffs, rems, title)

fig, (ga, az, nv, pa) = plt.subplots(1, 4, figsize = (20, 5))

(p, r, t) = plot("Georgia", "Trump lead")
ga.plot(p)
ga.plot(r)
ga.set_title(t)
ga.set_ylim(0)

(p, r, t) = plot("Arizona", "Biden lead")
az.plot(p)
az.plot(r)
az.set_title(t)
az.set_ylim(0)

(p, r, t) = plot("Nevada", "Biden lead")
nv.plot(p)
nv.plot(r)
nv.set_title(t)
nv.set_ylim(0)

(p, r, t) = plot("Pennsylvania", "Trump lead")
pa.plot(p)
pa.plot(r)
pa.set_title(t)
pa.set_ylim(0)

