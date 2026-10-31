#!/usr/bin/env python3
"""Render the on-screen hook as a transparent PNG card that always fits.

Text is measured with the real font (Pillow), wrapped into 1-3 balanced lines and
shrunk until the widest line fits inside --max-frac of the frame width.
Prints JSON {"w","h","lines","font_size"}.
"""
import argparse
import itertools
import json

from PIL import Image, ImageDraw, ImageFont

STYLES = {
    # bg RGBA, text RGB, accent RGB (None = no accent)
    "classic": ((255, 255, 255, 245), (10, 12, 16), (52, 211, 153)),
    "dark": ((8, 10, 14, 225), (255, 255, 255), (52, 211, 153)),
    "clapper": ((8, 10, 14, 225), (255, 255, 255), (52, 211, 153)),
    "bold": ((52, 211, 153, 250), (4, 36, 26), None),
    "sticker": ((255, 230, 0, 250), (10, 12, 16), None),
}


def line_w(font, text):
    l, _, r, _ = font.getbbox(text)
    return r - l


def wrap_k(words, font, k):
    """Best k-line split: minimise the widest line (hooks are short, brute force is fine)."""
    n = len(words)
    best = None
    for cuts in itertools.combinations(range(1, n), k - 1):
        idx = (0,) + cuts + (n,)
        lines = [" ".join(words[idx[i]:idx[i + 1]]) for i in range(k)]
        widest = max(line_w(font, ln) for ln in lines)
        if best is None or widest < best[1]:
            best = (lines, widest)
    return best


def best_wrap(words, font, max_lines, limit=None):
    """Fewest lines that fit `limit`; otherwise the narrowest arrangement."""
    fallback = None
    for k in range(1, min(max_lines, len(words)) + 1):
        lines, widest = wrap_k(words, font, k)
        if limit is not None and widest <= limit:
            return lines, widest
        if fallback is None or widest < fallback[1]:
            fallback = (lines, widest)
    return fallback


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True)
    ap.add_argument("--frame-w", type=int, required=True)
    ap.add_argument("--frame-h", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--font", required=True)
    ap.add_argument("--style", default="classic")
    ap.add_argument("--max-frac", type=float, default=0.88)
    ap.add_argument("--max-lines", type=int, default=3)
    a = ap.parse_args()

    W, H = a.frame_w, a.frame_h
    base = min(W, H)
    words = a.text.split()
    bg, fg, accent = STYLES.get(a.style, STYLES["classic"])
    max_w = W * a.max_frac
    top_size = int(base * 0.066)  # 1080 wide -> ~71px
    min_size = int(base * 0.036)
    chosen = None
    # Pass 1: big and compact (<=2 lines). Pass 2: allow 3 lines, keep shrinking.
    for lines_allowed, floor in ((2, int(base * 0.052)), (a.max_lines, min_size)):
        size = top_size
        while size >= floor and chosen is None:
            font = ImageFont.truetype(a.font, size)
            pad_x = int(size * 0.62)
            lines, widest = best_wrap(words, font, lines_allowed, max_w - 2 * pad_x)
            if widest + 2 * pad_x <= max_w:
                chosen = (font, size, pad_x, lines, widest)
            size -= 2
        if chosen:
            break
    if chosen is None:
        font = ImageFont.truetype(a.font, min_size)
        pad_x = int(min_size * 0.62)
        lines, widest = best_wrap(words, font, a.max_lines)
        # last resort: shrink exactly to fit
        while widest + 2 * pad_x > max_w and min_size > 18:
            min_size -= 2
            font = ImageFont.truetype(a.font, min_size)
            pad_x = int(min_size * 0.62)
            lines, widest = best_wrap(words, font, a.max_lines)
        chosen = (font, min_size, pad_x, lines, widest)

    font, size, pad_x, lines, widest = chosen
    ascent, descent = font.getmetrics()
    line_h = int((ascent + descent) * 1.0)
    gap = int(size * 0.08)
    pad_y = int(size * 0.42)
    accent_h = max(6, int(size * 0.11)) if accent else 0
    card_w = int(widest + 2 * pad_x)
    card_h = int(pad_y * 2 + line_h * len(lines) + gap * (len(lines) - 1) + accent_h)
    shadow = int(size * 0.18)
    img = Image.new("RGBA", (card_w + shadow * 2, card_h + shadow * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.38)
    # soft shadow
    d.rounded_rectangle(
        (shadow, shadow + int(shadow * 0.6), shadow + card_w, shadow + card_h + int(shadow * 0.6)),
        radius=radius,
        fill=(0, 0, 0, 90),
    )
    d.rounded_rectangle((shadow, shadow, shadow + card_w, shadow + card_h), radius=radius, fill=bg)
    if accent:
        # emerald accent strip along the bottom, inside the rounded card
        mask = Image.new("L", img.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (shadow, shadow, shadow + card_w, shadow + card_h), radius=radius, fill=255
        )
        strip = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(strip).rectangle(
            (shadow, shadow + card_h - accent_h, shadow + card_w, shadow + card_h), fill=accent + (255,)
        )
        img.paste(strip, (0, 0), Image.composite(strip, Image.new("RGBA", img.size), mask).split()[3])
        d = ImageDraw.Draw(img)
    y = shadow + pad_y
    for ln in lines:
        lw = line_w(font, ln)
        l, _, _, _ = font.getbbox(ln)
        d.text((shadow + (card_w - lw) / 2 - l, y), ln, font=font, fill=fg)
        y += line_h + gap
    img.save(a.out)
    print(json.dumps({"w": img.width, "h": img.height, "lines": lines, "font_size": size}))


if __name__ == "__main__":
    main()
