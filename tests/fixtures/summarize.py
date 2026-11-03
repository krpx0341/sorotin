"""Print a short summary of face_track.py JSON on stdin. Same fields QA used."""
import json
import sys

d = json.load(sys.stdin)
w, h = d["width"], d["height"]
total = d.get("sample_count")
rate = (d["samples"] / total) if total else 0
print(f"source {w}x{h}, duration {d['duration']}s, cuts {d['cuts']}")
extra = f" sample_count={total} hit_rate={rate:.2f}" if total else ""
print(
    f"samples_with_face={d['samples']} confidence={d['confidence']:.2f} "
    f"speaker_count={d['speaker_count']} face_clusters={len(d['faces'])}{extra}"
)
for i, fc in enumerate(d["faces"]):
    print(f"  face[{i}] cx={fc['cx']:.3f} cy={fc['cy']:.3f} w={fc['face_w']:.3f} h={fc['face_h']:.3f}")
for s in d["segments"]:
    cs = []
    for c in s["crops"]:
        piece = f"x={c['x']} y={c['y']} w={c['w']} h={c['h']} crop_cx={(c['x'] + c['w'] / 2) / w:.3f}"
        if "place_w" in c:
            piece += f" place=({c.get('place_x')},{c.get('place_w')})"
        cs.append(piece)
    print(f"  seg {s['start']}-{s['end']}s layout={s['layout']} faces_in_seg={len(s['faces'])} crops=[{'; '.join(cs)}]")
print(f"trim_start={d['trim_start']} trim_end={d['trim_end']} cover_t={d['cover']['t']}")
