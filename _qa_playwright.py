import json, re, sys
from playwright.sync_api import sync_playwright

URL = "https://divewatch-dream-page.lovable.app"
OUT = "/Users/jeongsanghun/Desktop/qa-screens/divewatch-dream-0704"

report = {}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---------- Desktop ----------
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, timeout=60000)
    page.wait_for_load_state("networkidle", timeout=60000)
    page.wait_for_timeout(3000)
    # scroll through to trigger lazy loads
    h = page.evaluate("document.body.scrollHeight")
    for y in range(0, h, 800):
        page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(250)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(1000)
    page.screenshot(path=f"{OUT}/desktop_full.png", full_page=True)

    body_text = page.evaluate("document.body.innerText")
    html = page.content()

    def find(pattern, where="text"):
        src = body_text if where == "text" else html
        return re.findall(pattern, src, re.IGNORECASE)

    # 1. $1 Stripe
    report["1_stripe_links"] = list(set(find(r'buy\.stripe\.com[^"\s]*', "html")))
    report["1_dollar1_text"] = find(r"[^\n]{0,60}\$1\b[^\n]{0,60}")
    report["1_reserve_deposit"] = find(r"[^\n]{0,50}(?:reserve|deposit)[^\n]{0,50}")

    # 2. Gamification (share -> $5 coupon)
    report["2_gamification"] = find(
        r"[^\n]{0,60}(?:\$5|coupon|referral|share.{0,30}friend|invite)[^\n]{0,60}"
    )

    # 4. Headline
    report["4_headline_hype"] = find(r"[^\n]{0,40}Hype[^\n]{0,40}")
    report["4_headline_nodeco"] = find(r"[^\n]{0,40}No[- ]?Deco[^\n]{0,40}")
    h1s = [el.inner_text() for el in page.locator("h1").all()]
    report["4_h1s"] = h1s

    # 5. Lovable badge
    report["5_lovable"] = find(r'[^\n"]{0,40}lovable[^\n"]{0,40}', "html")[:10]

    # 6. Internal marketing terms
    report["6_internal_terms"] = {
        t: len(find(t))
        for t in [
            "giftable",
            "aspirational",
            "Kickstarter-ready",
            "campaign-ready",
            "Kickstarter",
        ]
    }

    # 7. Compatibility section
    report["7_compat"] = find(
        r"[^\n]{0,80}(?:housing|Apple Watch|Galaxy|Pixel|Wear OS|Ultra)[^\n]{0,80}"
    )[:25]

    # 8. Broken/empty images
    imgs = page.evaluate("""
        Array.from(document.images).map(i => ({src: (i.currentSrc||i.src||'').slice(0,120), w: i.naturalWidth, h: i.naturalHeight, alt: i.alt}))
    """)
    report["8_broken_imgs"] = [i for i in imgs if i["w"] == 0]
    report["8_img_count"] = len(imgs)

    # 9. Action cams
    report["9_actioncam"] = {
        t: len(find(t)) for t in ["GoPro", "Insta360", "Canon", "Universal Pro", "DJI"]
    }

    # 10. Tech partners
    report["10_partners_text"] = find(
        r"[^\n]{0,70}(?:NVIDIA|AWS|Samsung|Trusted|Tech Partner|Inception|featured)[^\n]{0,70}"
    )[:15]

    # 11. App download
    report["11_app_download"] = find(
        r"[^\n]{0,60}(?:App Store|Google Play|[Dd]ownload)[^\n]{0,60}"
    )

    # Also grab all external links
    links = page.evaluate(
        "Array.from(document.querySelectorAll('a')).map(a=>a.href).filter(h=>h && !h.includes('divewatch-dream'))"
    )
    report["all_external_links"] = sorted(set(links))

    # Section-level screenshots (viewport sweeps top->bottom)
    n = 0
    for y in range(0, h, 850):
        page.evaluate(f"window.scrollTo(0, {y})")
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/desktop_s{n:02d}.png")
        n += 1
        if n > 14:
            break

    page.close()

    # ---------- Mobile ----------
    m = browser.new_page(
        viewport={"width": 390, "height": 844},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    )
    m.goto(URL, timeout=60000)
    m.wait_for_load_state("networkidle", timeout=60000)
    m.wait_for_timeout(3000)
    mh = m.evaluate("document.body.scrollHeight")
    for y in range(0, mh, 700):
        m.evaluate(f"window.scrollTo(0, {y})")
        m.wait_for_timeout(200)
    m.evaluate("window.scrollTo(0,0)")
    m.wait_for_timeout(800)
    m.screenshot(path=f"{OUT}/mobile_full.png", full_page=True)
    report["mobile_body_height"] = mh
    m.close()
    browser.close()

print(json.dumps(report, ensure_ascii=False, indent=1))
