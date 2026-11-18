from __future__ import annotations

import base64
import json
import math
import shutil
import subprocess
from html import escape
from pathlib import Path

from PIL import Image
from pypdf import PdfReader
from reportlab.graphics.barcode.qrencoder import QRCode, QRErrorCorrectLevel
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.work' / 'poster-draft'
PDF_DIR = ROOT / 'output' / 'pdf'
SOURCE_DIR = ROOT / 'output' / 'poster-draft'
SCREENSHOTS = ROOT / 'output' / 'poster-screenshots' / '01_포스터_핵심화면'
PDF_PATH = PDF_DIR / 'CampusRent_포스터_초안.pdf'
SVG_PATH = SOURCE_DIR / 'CampusRent_포스터_초안.svg'
PREVIEW_PATH = SOURCE_DIR / 'CampusRent_포스터_초안.png'
REPOSITORY = 'https://github.com/qkrrjsdud101010-ops/campus-rent'

WIDTH = 1800
HEIGHT = 2550
POINT_SCALE = (600 / 25.4 * 72) / WIDTH
NAVY = '#10234D'
INK = '#142745'
BLUE = '#2563EB'
MUTED = '#5C6F88'
LIGHT_BLUE = '#EFF5FF'
LINE = '#D8E3F2'
WHITE = '#FFFFFF'

for directory in (WORK, PDF_DIR, SOURCE_DIR):
    directory.mkdir(parents=True, exist_ok=True)

FONT_FILES = {
    'Body': Path('C:/Windows/Fonts/malgun.ttf'),
    'Bold': Path('C:/Windows/Fonts/malgunbd.ttf'),
}
for font_name, font_path in FONT_FILES.items():
    pdfmetrics.registerFont(TTFont(font_name, str(font_path)))


class Poster:
    """Draw a single shared layout into a print PDF and an editable SVG."""

    def __init__(self, pdf_path=PDF_PATH, svg_path=SVG_PATH,
                 checks_path=WORK / 'layout-checks.json',
                 title='CampusRent | New-Era 캡스톤디자인 포스터 개선 초안 | 2026.11.16'):
        self.svg_path = svg_path
        self.checks_path = checks_path
        self.title = title
        self.pdf = canvas.Canvas(
            str(pdf_path),
            pagesize=(WIDTH * POINT_SCALE, HEIGHT * POINT_SCALE),
            pageCompression=1,
        )
        self.pdf.setTitle(title)
        self.pdf.setAuthor('New-Era | 박건영 · 김세종 · 박준서')
        self.pdf.setSubject('교내 시설·장비 대여 및 관리 시스템 / 600 × 850 mm')
        self.pdf.scale(POINT_SCALE, POINT_SCALE)
        self.pdf.setLineJoin(1)
        self.elements = []
        self.text_records = []
        self.image_records = []
        self.layout_checks = []

    def rect(self, x, y, width, height, fill=WHITE, radius=0, stroke=None, line_width=1):
        self.pdf.setFillColor(HexColor(fill))
        self.pdf.setStrokeColor(HexColor(stroke or fill))
        self.pdf.setLineWidth(line_width)
        if radius:
            self.pdf.roundRect(x, HEIGHT - y - height, width, height, radius,
                               fill=1, stroke=bool(stroke))
        else:
            self.pdf.rect(x, HEIGHT - y - height, width, height,
                          fill=1, stroke=bool(stroke))
        stroke_attributes = ''
        if stroke:
            stroke_attributes = f' stroke="{stroke}" stroke-width="{line_width}"'
        self.elements.append(
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" '
            f'rx="{radius}" fill="{fill}"{stroke_attributes}/>'
        )

    def line(self, x1, y1, x2, y2, color=LINE, width=1):
        self.pdf.setStrokeColor(HexColor(color))
        self.pdf.setLineWidth(width)
        self.pdf.line(x1, HEIGHT - y1, x2, HEIGHT - y2)
        self.elements.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
        )

    def circle(self, x, y, radius, fill):
        self.pdf.setFillColor(HexColor(fill))
        self.pdf.circle(x, HEIGHT - y, radius, fill=1, stroke=0)
        self.elements.append(f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{fill}"/>')

    def text(self, x, baseline, value, size=24, color=INK, font='Body',
             max_width=None, align='left'):
        text_width = pdfmetrics.stringWidth(value, font, size)
        if max_width is not None:
            self.layout_checks.append({
                'text': value,
                'width': round(text_width, 2),
                'limit': max_width,
            })
            if text_width > max_width:
                raise ValueError(f'Text exceeds available width: {value} ({text_width:.1f}/{max_width})')
        draw_x = x - text_width / 2 if align == 'center' else x
        if draw_x < 0 or draw_x + text_width > WIDTH or baseline > HEIGHT:
            raise ValueError(f'Text exceeds poster bounds: {value}')
        self.pdf.setFont(font, size)
        self.pdf.setFillColor(HexColor(color))
        self.pdf.drawString(draw_x, HEIGHT - baseline, value)
        family = "'Malgun Gothic', 'Noto Sans KR', sans-serif"
        weight = '700' if font == 'Bold' else '400'
        anchor = 'middle' if align == 'center' else 'start'
        self.elements.append(
            f'<text x="{x}" y="{baseline}" font-family="{escape(family, quote=True)}" '
            f'font-size="{size}" font-weight="{weight}" fill="{color}" '
            f'text-anchor="{anchor}" xml:space="preserve">{escape(value)}</text>'
        )
        self.text_records.append(value)

    def lines(self, x, baseline, values, line_height=34, **kwargs):
        for index, value in enumerate(values):
            self.text(x, baseline + index * line_height, value, **kwargs)

    def image(self, path, x, y, width):
        with Image.open(path) as original:
            image_width, image_height = original.size
        height = width * image_height / image_width
        self.pdf.drawImage(ImageReader(str(path)), x, HEIGHT - y - height,
                           width=width, height=height, mask='auto')
        encoded = base64.b64encode(path.read_bytes()).decode('ascii')
        self.elements.append(
            f'<image x="{x}" y="{y}" width="{width}" height="{height:.5f}" '
            f'preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,{encoded}"/>'
        )
        self.image_records.append({
            'source': str(path.relative_to(ROOT)),
            'native_pixels': [image_width, image_height],
            'placement': [x, y, width, height],
            'print_dpi': round(image_width / (width / 3 / 25.4), 1),
        })
        return height

    def arrow(self, x, y, length=25, color=BLUE, width=3):
        self.line(x, y, x + length, y, color, width)
        self.line(x + length - 8, y - 7, x + length, y, color, width)
        self.line(x + length - 8, y + 7, x + length, y, color, width)

    def qr(self, x, y, size, url):
        qr = QRCode(version=None, errorCorrectLevel=QRErrorCorrectLevel.M)
        qr.addData(url)
        qr.make()
        quiet_zone = 4
        count = len(qr.modules)
        module_size = size / (count + 2 * quiet_zone)
        self.rect(x, y, size, size, WHITE, radius=3)
        for row, modules in enumerate(qr.modules):
            for column, dark in enumerate(modules):
                if dark:
                    self.rect(
                        x + (column + quiet_zone) * module_size,
                        y + (row + quiet_zone) * module_size,
                        module_size + 0.02,
                        module_size + 0.02,
                        NAVY,
                    )
        self.pdf.linkURL(url, (x, HEIGHT - y - size, x + size, HEIGHT - y), relative=0)
        self.elements.append(
            f'<a href="{escape(url, quote=True)}"><rect x="{x}" y="{y}" '
            f'width="{size}" height="{size}" fill="transparent"/></a>'
        )

    def save(self):
        self.pdf.showPage()
        self.pdf.save()
        svg = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            'width="600mm" height="850mm" viewBox="0 0 1800 2550" role="img" '
            'aria-labelledby="poster-title poster-description">',
            f'<title id="poster-title">{escape(self.title)}</title>',
            '<desc id="poster-description">활동 문장 분석, 사용자 조건 확인, DB·추천 규칙 조회, 선택·신청으로 연결하는 교내 시설·장비 대여 시스템. '
            '600 × 850 mm. Text and shapes are editable. Screenshots are embedded raster images. '
            'Korean font: Malgun Gothic or Noto Sans KR.</desc>',
            *self.elements,
            '</svg>',
        ]
        self.svg_path.write_text('\n'.join(svg), encoding='utf-8')
        self.checks_path.write_text(json.dumps({
            'text_width_checks': self.layout_checks,
            'screenshots': self.image_records,
            'texts': self.text_records,
        }, ensure_ascii=False, indent=2), encoding='utf-8')
