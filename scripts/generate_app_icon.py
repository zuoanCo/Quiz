from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
PUBLIC_DIR = ROOT / "public"


def rounded_rectangle(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_icon(size=1024):
    scale = size / 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Soft blue system-style app tile.
    for y in range(size):
        ratio = y / max(size - 1, 1)
        r = int(30 + (14 - 30) * ratio)
        g = int(116 + (92 - 116) * ratio)
        b = int(255 + (205 - 255) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    rounded_rectangle(draw, (0, 0, size - 1, size - 1), int(220 * scale), fill=None, outline=(255, 255, 255, 56), width=max(1, int(6 * scale)))

    shadow_offset = int(22 * scale)
    shadow_box = (
        int(248 * scale),
        int(166 * scale) + shadow_offset,
        int(780 * scale),
        int(844 * scale) + shadow_offset,
    )
    rounded_rectangle(draw, shadow_box, int(72 * scale), fill=(8, 34, 92, 62))

    page_box = (
        int(222 * scale),
        int(148 * scale),
        int(754 * scale),
        int(826 * scale),
    )
    rounded_rectangle(draw, page_box, int(72 * scale), fill=(255, 255, 255, 246))

    spine_box = (
        int(222 * scale),
        int(148 * scale),
        int(338 * scale),
        int(826 * scale),
    )
    rounded_rectangle(draw, spine_box, int(72 * scale), fill=(226, 237, 255, 255))
    draw.rectangle(
        (
            int(298 * scale),
            int(148 * scale),
            int(350 * scale),
            int(826 * scale),
        ),
        fill=(226, 237, 255, 255),
    )

    for y in (288, 422, 556):
        draw.ellipse(
            (
                int(265 * scale),
                int((y - 18) * scale),
                int(301 * scale),
                int((y + 18) * scale),
            ),
            fill=(23, 102, 237, 255),
        )
        draw.rounded_rectangle(
            (
                int(390 * scale),
                int((y - 18) * scale),
                int(650 * scale),
                int((y + 18) * scale),
            ),
            radius=int(18 * scale),
            fill=(202, 214, 232, 255),
        )

    # Completion checkmark.
    check = [
        (int(398 * scale), int(675 * scale)),
        (int(486 * scale), int(760 * scale)),
        (int(684 * scale), int(560 * scale)),
    ]
    draw.line(check, fill=(21, 171, 89, 255), width=int(58 * scale), joint="curve")
    draw.line(check, fill=(255, 255, 255, 255), width=int(26 * scale), joint="curve")

    # Pencil accent for "assistant" and question editing.
    pencil = [
        (int(686 * scale), int(236 * scale)),
        (int(804 * scale), int(354 * scale)),
        (int(742 * scale), int(416 * scale)),
        (int(624 * scale), int(298 * scale)),
    ]
    draw.polygon(pencil, fill=(255, 190, 76, 255))
    draw.polygon(
        [
            (int(804 * scale), int(354 * scale)),
            (int(850 * scale), int(400 * scale)),
            (int(742 * scale), int(416 * scale)),
        ],
        fill=(31, 41, 55, 255),
    )
    draw.line(
        [(int(646 * scale), int(276 * scale)), (int(764 * scale), int(394 * scale))],
        fill=(255, 236, 197, 255),
        width=int(20 * scale),
    )

    return image


def main():
    BUILD_DIR.mkdir(exist_ok=True)
    PUBLIC_DIR.mkdir(exist_ok=True)

    base = draw_icon(1024)
    png_path = BUILD_DIR / "icon.png"
    ico_path = BUILD_DIR / "icon.ico"
    public_png_path = PUBLIC_DIR / "icon.png"

    base.save(png_path)
    base.resize((256, 256), Image.Resampling.LANCZOS).save(public_png_path)

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.save(ico_path, sizes=sizes)

    print(f"Generated {png_path}")
    print(f"Generated {ico_path}")
    print(f"Generated {public_png_path}")


if __name__ == "__main__":
    main()
