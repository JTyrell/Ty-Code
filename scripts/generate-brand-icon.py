"""Render the Ty-Code icon SVG geometry as a 1024px PNG for electron-builder 25.x."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SCALE = 2
CANVAS = SIZE * SCALE
WHITE = (255, 255, 255, 255)

# Match the project's violet-to-cyan brand mark with a dark-to-light diagonal.
image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
pixels = image.load()
x0, y0 = 128 * SCALE, 104 * SCALE
x1, y1 = 896 * SCALE, 920 * SCALE
dx, dy = x1 - x0, y1 - y0
length_squared = dx * dx + dy * dy
start = (139, 92, 246)
end = (6, 182, 212)

for y in range(CANVAS):
    for x in range(CANVAS):
        amount = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / length_squared))
        color = tuple(round(a + (b - a) * amount) for a, b in zip(start, end))
        pixels[x, y] = (*color, 255)

mask = Image.new("L", (CANVAS, CANVAS), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    (40 * SCALE, 40 * SCALE, 984 * SCALE, 984 * SCALE),
    radius=224 * SCALE,
    fill=255,
)
transparent = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
image = Image.composite(image, transparent, mask)
draw = ImageDraw.Draw(image)
line_width = 52 * SCALE
cap_radius = line_width // 2

# CPU package outline and pins.
draw.rounded_rectangle(
    (280 * SCALE, 280 * SCALE, 744 * SCALE, 744 * SCALE),
    radius=104 * SCALE,
    outline=WHITE,
    width=line_width,
)


def stroke(points: list[tuple[int, int]]) -> None:
    scaled = [(x * SCALE, y * SCALE) for x, y in points]
    draw.line(scaled, fill=WHITE, width=line_width, joint="curve")
    for x, y in (scaled[0], scaled[-1]):
        draw.ellipse((x - cap_radius, y - cap_radius, x + cap_radius, y + cap_radius), fill=WHITE)


for x in (400, 512, 624):
    stroke([(x, 280), (x, 204)])
    stroke([(x, 820), (x, 744)])
for y in (400, 512, 624):
    stroke([(280, y), (204, y)])
    stroke([(820, y), (744, y)])

# Code/editor glyph: < / >.
stroke([(442, 438), (368, 512), (442, 586)])
stroke([(582, 438), (656, 512), (582, 586)])
stroke([(548, 422), (476, 602)])

build_dir = Path(__file__).resolve().parents[1] / "build"
image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
image.save(build_dir / "icon.png", format="PNG", optimize=True)

# Provide conventional hicolor sizes for Linux desktop environments.
icon_set_dir = build_dir / "icons"
icon_set_dir.mkdir(parents=True, exist_ok=True)
for size in (16, 24, 32, 48, 64, 128, 256, 512):
    image.resize((size, size), Image.Resampling.LANCZOS).save(
        icon_set_dir / f"{size}x{size}.png",
        format="PNG",
        optimize=True,
    )
