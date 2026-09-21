"""Optional built-Client proof against the existing isolated search-routing fixture.

Use an already installed Python Playwright runtime and Edge. This runner neither
starts a server nor installs dependencies. Example:
  python tests/browser/verify-role-retirement.py --url http://127.0.0.1:PORT/search --output C:/tmp/role-retirement

The search fixture activates only the search child of the actual built apply().
Export/DOM absence here complements, not replaces, the real Cordis all-slot
regression in client-no-model-roles.spec.ts. No live DSH acceptance is claimed.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="Existing isolated search-routing fixture URL")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--channel", default="msedge")
    args = parser.parse_args()
    target = urlsplit(args.url)
    if target.scheme != "http" or target.hostname not in ("127.0.0.1", "localhost", "::1"):
        parser.error("Use an HTTP loopback isolated-fixture URL, not a remote or production page")
    if target.username or target.password:
        parser.error("Fixture URLs must not contain credentials")
    args.output.mkdir(parents=True, exist_ok=True)
    origin = (target.scheme, target.netloc)
    errors = []
    evidence = {"synthetic": True, "liveDsh": False, "channel": args.channel}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.channel, headless=True)
        try:
            context = browser.new_context(viewport={"width": 900, "height": 900}, locale="en-US")

            def local_only(route):
                address = urlsplit(route.request.url)
                if (address.scheme, address.netloc) == origin:
                    route.continue_()
                else:
                    errors.append({"kind": "non-fixture-request", "url": route.request.url})
                    route.abort()

            context.route("**/*", local_only)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append({"kind": "pageerror", "message": str(error)}))
            page.on("console", lambda message: errors.append({"kind": "console", "message": message.text}) if message.type == "error" else None)
            page.on("requestfailed", lambda request: errors.append({"kind": "requestfailed", "url": request.url, "failure": request.failure}))
            page.on("response", lambda response: errors.append({"kind": "http", "url": response.url, "status": response.status}) if response.status >= 400 else None)
            response = page.goto(args.url, wait_until="networkidle")
            assert response is not None and response.ok, "Fixture navigation failed"
            expect(page).to_have_title("Search routing — isolated component verification")
            expect(page.locator("[data-dsh-web-search-routing]")).to_be_visible()
            expect(page.locator("[data-dsh-web-search-mode]")).to_be_enabled()

            exports = page.evaluate("""() => ({
                role: 'DualModelCard' in window.CopilotUI,
                apply: typeof window.CopilotUI.apply,
                search: typeof window.CopilotUI.WebSearchRoutingCard,
                usage: typeof window.CopilotUI.CopilotUsageCard
            })""")
            assert exports == {"role": False, "apply": "function", "search": "function", "usage": "function"}, exports

            def absent_roles():
                expect(page.locator("[data-dsh-dual-model-card], [data-dsh-dual-model-planner], [data-dsh-dual-model-executor], [data-dsh-dual-model-create]")).to_have_count(0)
                assert "Model roles" not in page.locator("body").inner_text()
                assert "模型分工" not in page.locator("body").inner_text()
                expect(page.locator("[data-dsh-web-search-routing] select")).to_have_count(2)

            absent_roles()
            initial = page.evaluate("() => ({ writes: window.fixture.calls.length, status: window.fixture.statusCalls })")
            assert initial == {"writes": 0, "status": 0}, initial
            page.locator("[data-dsh-web-search-mode]").select_option("github-copilot-hosted")
            page.locator("[data-dsh-web-search-provider]").select_option("exa")
            page.evaluate("() => window.fixture.render()")
            expect(page.locator("[data-dsh-web-search-mode]")).to_have_value("github-copilot-hosted")
            expect(page.locator("[data-dsh-web-search-provider]")).to_have_value("exa")
            page.locator("[data-dsh-web-search-save]").click()
            page.wait_for_function("() => window.fixture.calls.length === 1 && window.fixture.routingRevision === 5")
            expect(page.locator("[data-dsh-web-search-save]")).to_be_enabled()
            expect(page.locator("[data-dsh-web-search-routing]")).to_contain_text("Saved. New searches use this routing.")
            calls = page.evaluate("() => window.fixture.calls")
            assert calls == [{"id": "github-copilot-search-routing", "operations": [
                {"op": "set", "path": ["searchProvider"], "value": "github-copilot-hosted"},
                {"op": "set", "path": ["defaultSearchProvider"], "value": "exa"},
            ], "revision": 4}], calls
            assert page.evaluate("() => window.fixture.statusCalls") == 0
            absent_roles()
            page.screenshot(path=str(args.output / "retired-roles-search-desktop.png"), full_page=True)
            page.set_viewport_size({"width": 375, "height": 812})
            absent_roles()
            assert not page.evaluate("() => document.documentElement.scrollWidth > innerWidth"), "Narrow layout overflows"
            page.screenshot(path=str(args.output / "retired-roles-search-narrow.png"), full_page=True)
            evidence.update({"browserVersion": browser.version, "exports": exports, "searchWrites": calls,
                             "roleDomAbsent": True, "narrowOverflow": False, "errors": errors})
            assert not errors, errors
            (args.output / "results.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"ok": True, "synthetic": True, "liveDsh": False, "output": str(args.output)}))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
