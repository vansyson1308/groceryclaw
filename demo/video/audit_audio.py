#!/usr/bin/env python3
"""Listening QA for the demo video's voices (optional; needs `pip install faster-whisper`).

For every synthesized clip (narration N1-N6 plus the recorded owner/assistant turns):
  * transcribes it with Whisper and computes a word error rate against the text that
    was meant to be spoken (both sides passed through speakable(), so "$210" and
    "two hundred ten dollars" compare equal);
  * finds inner pauses (silencedetect) beyond what the punctuation explains, i.e. the
    hesitations a listener hears as stumbling.
Writes demo/video/out/audio-audit.json and exits 1 if a clip fails the thresholds.

With --retake N, a failing clip is re-synthesized up to N times; a new take replaces it
only if it passes and grows by at most --max-grow seconds; durations.json / timeline.json
are updated so the subtitles and card lengths follow.
Then re-run `node demo/video/assemble.mjs`.

Usage: python3 demo/video/audit_audio.py [--max-wer 0.1] [--model small.en] [--retake 4]
"""
import argparse, json, re, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("--max-wer", type=float, default=0.1)
ap.add_argument("--model", default="small.en")
ap.add_argument("--retake", type=int, default=0)
# Turns are followed by 1.3 s of air in record.mjs, and narration cards are sized
# from durations.json, so a slightly longer retake still fits.
ap.add_argument("--max-grow", type=float, default=0.5)
args = ap.parse_args()

from faster_whisper import WhisperModel  # noqa: E402

model = WhisperModel(args.model, device="cpu", compute_type="int8")


def speakable(texts):
    js = "import('./demo/video/lib/speakable.mjs').then(m=>process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map(m.speakable))))"
    out = subprocess.run(["node", "-e", js, json.dumps(texts)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def words(t):
    return re.sub(r"[^a-z0-9' ]", " ", t.lower().replace("-", " ")).split()


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[:], i
        for j in range(1, len(h) + 1):
            d[j] = min(prev[j] + 1, d[j - 1] + 1, prev[j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(h)] / max(1, len(r))


def pauses(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "silencedetect=noise=-35dB:d=0.28", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                               capture_output=True, text=True).stdout)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    return [round(b - a, 2) for a, b in zip(starts, ends) if a > 0.05 and b < dur - 0.05], dur


VOCAB = "ShopVoice, KiotViet, MCP, Alexa+, Amazon Bedrock, Polly, Postgres, AWS CDK, Green Valley Dairy & Eggs, Sunrise Beverages."
narr = json.load(open("demo/video/narration/durations.json"))["durations"]
timeline = json.load(open("demo/video/out/timeline.json"))
clips = [(k, v["file"], v["text"]) for k, v in narr.items()]
clips += [(f"{e['role']}-{i}", e["file"], e["text"]) for i, e in enumerate(timeline["events"]) if e["role"] != "narrator"]

def check(path, say):
    # Proper nouns a viewer reads in the subtitles; without them Whisper guesses
    # spellings for names it has never seen (e.g. "KiotViet").
    segs, _ = model.transcribe(path, language="en", beam_size=5, initial_prompt=VOCAB)
    heard = " ".join(s.text.strip() for s in segs)
    # Whisper writes codes like "SR-B10442"; put them back in the SRB-10442 shape.
    heard = re.sub(r"\b([A-Z]{1,5})-?([A-Z]{0,4})(\d{3,})\b", lambda m: f"{m.group(1)}{m.group(2)}-{m.group(3)}", heard)
    w = wer(say, speakable([heard])[0])
    gaps, dur = pauses(path)
    expected = len(re.findall(r"[.,;:!?]", re.sub(r"[.!?]\s*$", "", say)))
    excess = max(0, len(gaps) - expected)
    longest = max(gaps) if gaps else 0.0
    return w <= args.max_wer and excess == 0 and longest <= 0.8, w, excess, longest, dur, heard


def role_of(cid):
    return "narrator" if cid.startswith("N") else cid.split("-")[0]


spoken = speakable([c[2] for c in clips])
report, failed, retaken = [], False, False
for (cid, path, text), say in zip(clips, spoken):
    ok, w, excess, longest, dur, heard = check(path, say)
    for attempt in range(args.retake if not ok else 0):
        tmp = f"/tmp/retake-{cid}-{attempt}.mp3"
        subprocess.run(["node", "demo/video/synth_one.mjs", role_of(cid), tmp, text], check=True, capture_output=True)
        r = check(tmp, say)
        print(f"      retake {attempt + 1} for {cid}: {'pass' if r[0] else 'fail'} wer={r[1]:.2f} {r[4]:.1f}s")
        if r[0] and r[4] <= dur + args.max_grow:
            subprocess.run(["cp", tmp, path], check=True)
            ok, w, excess, longest, dur, heard = r
            if cid in narr:
                narr[cid]["seconds"] = dur
            else:
                timeline["events"][int(cid.split("-")[1])]["seconds"] = dur
            retaken = True
            break
    failed |= not ok
    report.append({"id": cid, "ok": ok, "wer": round(w, 3), "excess_pauses": excess, "longest_pause": longest, "seconds": round(dur, 2), "heard": heard})
    print(f"{'PASS' if ok else 'FAIL'}  {cid:12} wer={w:.2f} excess_pauses={excess} longest_pause={longest:.2f}s  {dur:.1f}s")
    if not ok or w > 0:
        print(f"      heard: {heard}")

if retaken:
    durations = json.load(open("demo/video/narration/durations.json"))
    durations["durations"] = narr
    json.dump(durations, open("demo/video/narration/durations.json", "w"), indent=2)
    json.dump(timeline, open("demo/video/out/timeline.json", "w"), indent=2)
    print("retakes applied: run `node demo/video/assemble.mjs` to rebuild the video")
json.dump(report, open("demo/video/out/audio-audit.json", "w"), indent=2)
print(f"{sum(r['ok'] for r in report)}/{len(report)} clips pass; report: demo/video/out/audio-audit.json")
sys.exit(1 if failed else 0)
