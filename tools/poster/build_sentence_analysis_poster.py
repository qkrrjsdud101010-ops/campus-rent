"""Build the sentence-analysis revision without changing the original poster.

Run with Python containing reportlab, Pillow and pypdf. Requires Poppler.
Screenshots are real, unretouched crops; see the asset manifest for provenance.
"""
from pathlib import Path
import json
import math
import shutil
import subprocess

from pypdf import PdfReader
from poster_canvas import Poster

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'output/poster-draft/assets-sentence-analysis'
WORK = ROOT / '.work/poster-draft'
PDF_PATH = ROOT / 'output/pdf/CampusRent_포스터_문장분석반영.pdf'
SVG_PATH = ROOT / 'output/poster-draft/CampusRent_포스터_문장분석반영.svg'
PNG_PATH = ROOT / 'output/poster-draft/CampusRent_포스터_문장분석반영.png'

PAPER, INK, MUTED, LINE = '#FAF8F3', '#182636', '#606A72', '#D6D5CE'
BLUE, TEAL, AMBER, WHITE = '#245AD0', '#08786F', '#B45E22', '#FFFFFF'


def screen_frame(poster, x, y, width, height, tone, caption):
    poster.rect(x + 7, y + 9, width, height, '#DAD8D0', radius=15)
    poster.rect(x, y, width, height, tone, radius=15)
    poster.text(x + 26, y + 31, caption, 20, WHITE, max_width=width - 52)


def problem(poster, top, category, question, feature, description, accent):
    poster.text(80, top + 40, category, 24, accent, font='Bold', max_width=440)
    poster.line(80, top + 65, 190, top + 65, accent, 4)
    poster.lines(80, top + 116, question, line_height=47, size=38,
                 color=INK, font='Bold', max_width=440)
    poster.text(80, top + 240, feature, 28, accent, font='Bold', max_width=440)
    poster.lines(80, top + 290, description, line_height=37, size=24,
                 color=MUTED, max_width=440)


def draw_poster(poster):
    poster.rect(0, 0, 1800, 2550, PAPER)
    poster.text(80, 58, '한남대학교 · New-Era · 2026 정보시스템 캡스톤디자인', 23, MUTED, max_width=1640)
    poster.text(74, 164, 'CampusRent', 92, INK, font='Bold', max_width=980)
    poster.text(81, 225, '교내 시설·장비 대여 및 관리 시스템', 34, INK, font='Bold', max_width=980)
    poster.lines(1140, 117, ['목적에 맞게 찾고,', '신청 이후까지 확인하세요.'],
                 line_height=46, size=32, color=INK, max_width=580)
    poster.text(1140, 225, '문제 가설과 주요 구현 화면', 21, MUTED, max_width=580)
    poster.line(80, 268, 1720, 268, LINE, 1.5)

    problem(poster, 325, '탐색의 어려움', ['무엇을 빌려야', '할지 모르겠다면'],
            '문장 분석·목적별 추천',
            ['GPT가 활동 문장을 분석해', '인원과 준비 항목을 제안합니다.',
             '사용자가 확인한 조건과', '등록 규칙으로 시설·장비와', '추천 이유를 안내합니다.'], BLUE)
    poster.lines(80, 824, ['활동 문장 분석 → 사용자 조건 확인',
                            'DB·추천 규칙 조회 → 선택 및 신청'],
                 line_height=33, size=21, color=BLUE, font='Bold', max_width=440)
    poster.text(80, 906, 'OpenAI API의 역할: 활동 문장 분석', 20, MUTED, max_width=440)
    screen_frame(poster, 600, 325, 1120, 630, '#192D49',
                 '① 문장 분석·확인 → ② 추천 결과 · 실제 서버 2026.11.18 · 가상 자원')
    poster.image(ASSETS / 'analysis-input.png', 625, 380, 600)
    poster.image(ASSETS / 'analysis-overview.png', 625, 440, 600)
    poster.image(ASSETS / 'analysis-confirm.png', 625, 866, 600)
    poster.text(1250, 392, '② 사용자 확인 후 추천 결과', 22, WHITE,
                font='Bold', max_width=440)
    poster.image(ASSETS / 'recommended-facility.png', 1250, 416, 440)
    poster.text(1250, 600, '공간: 사용자가 필요 조건 유지', 20, '#C4D3E8', max_width=440)
    poster.text(1250, 648, '영상 촬영에 필요한 장비 후보', 22, WHITE, font='Bold', max_width=440)
    poster.image(ASSETS / 'recommended-equipment.png', 1250, 672, 440)
    poster.lines(1250, 863, ['허용 목적·재고·가용성은', '서버·Oracle 데이터로 확인',
                            '각 화면의 핵심 부분 발췌'],
                 line_height=29, size=20, color='#C4D3E8', max_width=440)

    problem(poster, 1015, '이용 불가 시의 반복 탐색',
            ['원하는 자원을', '이용하기 어렵다면'], '대체 자원·다른 일정 비교',
            ['같은 일정의 대체 자원과', '같은 자원의 다른 일정을',
             '구분해 비교하고 다시 선택합니다.'], TEAL)
    screen_frame(poster, 600, 1015, 1120, 600, '#173E39',
                 '대체 시설·일정 변경 · 화면설계서 시연 2026.10')
    poster.image(ASSETS / 'alternative-tabs.png', 625, 1072, 600)
    poster.text(625, 1346, '같은 자원 · 다른 기간으로 변경할 때', 22, '#B6DFD8', font='Bold', max_width=600)
    poster.image(ASSETS / 'period-change.png', 625, 1366, 600)
    poster.image(ASSETS / 'alternative-facility.png', 1250, 1072, 440)

    problem(poster, 1685, '신청 이후의 확인 어려움',
            ['신청 후 진행이', '궁금하다면'], '신청 상태·반납 이력 확인',
            ['관리자 승인·거절과 진행 상태,', '출고 당시 구성품을 확인합니다.',
             '반납 보류와 추가 반환의', '누락 수량을 다시 확인합니다.'], AMBER)
    screen_frame(poster, 600, 1685, 1120, 600, '#493426',
                 '신청 현황·반납 검수 · 화면설계서 시연 2026.10')
    poster.image(ASSETS / 'request-status.png', 625, 1734, 650)
    poster.text(1310, 1748, '관리자 · 출고 기준과 반환 확인', 19, '#F6D8BF', max_width=380)
    poster.image(ASSETS / 'return-inspection.png', 1310, 1764, 380)
    poster.text(625, 2259, '화면 예시: 승인 대기 · 출고 기준 수량과 누적 반환량을 비교하는 구성품 검수',
                20, '#F6D8BF', max_width=1065)

    poster.text(900, 2326, 'Spring Boot · Thymeleaf · Oracle 11g XE', 24, MUTED,
                align='center', max_width=1640)
    poster.text(900, 2364, '2026.11.18 · Java 단위 테스트 97개 통과 · GPT 활동 문장 분석 실제 호출 성공',
                20, MUTED, align='center', max_width=1640)
    poster.text(900, 2398, 'GPT는 활동 조건을 제안하고, 시설·장비 선택과 신청은 사용자가 확인합니다.',
                19, MUTED, align='center', max_width=1640)
    poster.line(80, 2420, 1720, 2420, LINE, 1)
    poster.text(900, 2474, 'New-Era', 27, INK, font='Bold', align='center', max_width=1640)
    poster.text(900, 2520, '박건영 PM  ·  김세종 Backend·DB  ·  박준서 Frontend·UI',
                22, MUTED, align='center', max_width=1640)


def main():
    manifest = json.loads((ASSETS / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['external_call']['source'] == 'ai'
    assert manifest['external_call']['http_status'] == 200
    assert manifest['unit_tests'] == {'date': '2026-11-18', 'tests':97, 'failures':0, 'errors':0}
    poster = Poster(pdf_path=PDF_PATH, svg_path=SVG_PATH,
                    checks_path=WORK / 'sentence-layout-checks.json',
                    title='CampusRent | 문장 분석 반영 포스터 | 2026.11.18')
    draw_poster(poster)
    poster.save()
    bundled = Path('C:/Users/rjsdu/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')
    poppler = shutil.which('pdftoppm') or str(bundled)
    if not Path(poppler).is_file():
        raise RuntimeError('Poppler pdftoppm is required to render the final PDF.')
    subprocess.run([poppler, '-png', '-singlefile', '-scale-to', '5100', str(PDF_PATH),
                    str(PNG_PATH.with_suffix(''))], check=True, capture_output=True)
    reader = PdfReader(PDF_PATH)
    assert len(reader.pages) == 1
    page = reader.pages[0]
    mm = [float(page.mediabox.width)*25.4/72, float(page.mediabox.height)*25.4/72]
    assert math.isclose(mm[0],600,abs_tol=.01) and math.isclose(mm[1],850,abs_tol=.01)
    text = page.extract_text()
    for required in ['문장 분석·목적별 추천', 'GPT가 활동 문장을 분석해', '사용자 조건 확인',
                     '대체 자원·다른 일정 비교', '반납 보류', 'Oracle 11g XE', '97개',
                     '실제 호출 성공', '박건영 PM', '김세종 Backend·DB', '박준서 Frontend·UI']:
        assert required in text, required
    for removed in ['기획 단계의 문제 가설과 대응 화면','2026.11.12','GitHub','API 키']:
        assert removed not in text, removed
    assert len(page.get('/Annots',[])) == 0
    for record in poster.image_records:
        x,y,w,h = record['placement']
        assert x>=600 and x+w<=1720 and y+h<=2285
    print(json.dumps({'pages':1,'size_mm':mm,'images':len(poster.image_records),
                      'checked_text_rows':len(poster.layout_checks),'png_pixels':[3600,5100]}, ensure_ascii=True))


if __name__ == '__main__':
    main()
