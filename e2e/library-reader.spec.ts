import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __MANGAVAULT_FULLSCREEN_AUDIT__?: { requests: number; exits: number };
  }
}

test("shows a direct multi-folder empty state for a genuinely new user", async ({ page }) => {
  await page.goto("/?new-user=1");

  await expect(page.getByText("尚未添加漫画文件夹")).toBeVisible();
  await expect(page.getByText(/可以添加多个独立目录/)).toBeVisible();
  await expect(page.getByRole("button", { name: "添加漫画文件夹" })).toBeVisible();
  await expect(page.getByText("发现此 Windows 用户账户中已有 MangaVault 本地数据。")).toHaveCount(
    0,
  );
});

test("requires an explicit choice when this Windows account already has local data", async ({
  page,
}) => {
  await page.goto("/?existing-data=1");

  await expect(page.getByText("发现此 Windows 用户账户中已有 MangaVault 本地数据。")).toBeVisible();
  await expect(page.locator("nav")).toHaveCount(0);

  await page.getByRole("button", { name: "查看数据位置" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MANGAVAULT_E2E__?: { calls: Array<{ cmd: string; args: unknown }> };
            }
          ).__MANGAVAULT_E2E__?.calls.find((call) => call.cmd === "open_path_in_shell")?.args,
      ),
    )
    .toEqual({ path: String.raw`\\?\D:\MangaVaultData` });

  await page.getByRole("button", { name: "继续使用现有数据" }).click();
  await expect(page.locator("nav")).toBeVisible();
  await expect(page.getByText("发现此 Windows 用户账户中已有 MangaVault 本地数据。")).toHaveCount(
    0,
  );
});

test("keeps long paths internal while library settings and Recent show reader-friendly details", async ({
  page,
}) => {
  await page.goto("/?long-path=1");
  await page.getByRole("button", { name: "最近阅读" }).click();

  await expect(page.getByText(/2\/3/)).toBeVisible();
  await expect(page.getByText(/最后阅读/)).toBeVisible();
  await expect(page.getByText(String.raw`\\?\D:\漫画\作品`, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "漫画库", exact: true }).last().click();
  await expect(page.getByText(String.raw`D:\漫画\作品`, { exact: true })).toBeVisible();
});

test("requires two steps and a healthy backup before clearing local database data", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button").last().click();
  await page.getByRole("button", { name: "备份与本地数据" }).click();
  await page.getByText("危险操作").click();

  await page.getByRole("button", { name: "清空 MangaVault 本地数据库", exact: true }).click();
  await expect(page.getByText("这是高风险操作，请再次确认。")).toBeVisible();
  await page.getByRole("button", { name: "创建备份并准备清空" }).click();

  await expect(page.getByText("健康备份已创建，重启后将安全重新开始。")).toBeVisible();
  await expect(page.getByRole("button", { name: "立即重启" })).toBeVisible();
  const commands = await page.evaluate(
    () =>
      (
        window as unknown as {
          __MANGAVAULT_E2E__?: { calls: Array<{ cmd: string }> };
        }
      ).__MANGAVAULT_E2E__?.calls.map((call) => call.cmd) ?? [],
  );
  expect(commands.filter((command) => command === "schedule_database_reset")).toHaveLength(1);
  expect(commands).not.toContain("restart_application");
});

async function installFullscreenMock(
  page: Page,
  options: { fail?: boolean; delayMs?: number } = {},
) {
  await page.addInitScript(({ fail, delayMs }) => {
    let activeFullscreenElement: Element | null = null;
    const audit = { requests: 0, exits: 0 };
    (
      window as unknown as {
        __MANGAVAULT_FULLSCREEN_AUDIT__?: typeof audit;
      }
    ).__MANGAVAULT_FULLSCREEN_AUDIT__ = audit;
    Object.defineProperty(Document.prototype, "fullscreenElement", {
      configurable: true,
      get: () => activeFullscreenElement,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: async function requestFullscreen(this: Element) {
        audit.requests += 1;
        if (delayMs) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        if (fail) throw new Error("Fullscreen denied by test environment");
        activeFullscreenElement = this;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
    Object.defineProperty(Document.prototype, "exitFullscreen", {
      configurable: true,
      value: async () => {
        audit.exits += 1;
        activeFullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      },
    });
  }, options);
}

async function revealReaderTopControls(page: Page, reader: ReturnType<Page["locator"]>) {
  const bounds = await reader.boundingBox();
  if (!bounds) throw new Error("reader bounds unavailable");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 4);
  await page.waitForTimeout(160);
  await expect(reader).toHaveAttribute("data-reader-chrome", /^(all|top)$/);
}

test("keeps capability probing and listeners stable across twenty-one navigation changes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const audit = { active: 0, added: 0, removed: 0 };
    const registrations: Array<{
      target: EventTarget;
      type: string;
      callback: EventListenerOrEventListenerObject;
      capture: boolean;
    }> = [];
    const originalAdd = EventTarget.prototype.addEventListener;
    const originalRemove = EventTarget.prototype.removeEventListener;
    const captureValue = (options?: boolean | EventListenerOptions) =>
      typeof options === "boolean" ? options : Boolean(options?.capture);

    EventTarget.prototype.addEventListener = function (
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (callback && (this === window || this === document)) {
        const capture = captureValue(options);
        const exists = registrations.some(
          (entry) =>
            entry.target === this &&
            entry.type === type &&
            entry.callback === callback &&
            entry.capture === capture,
        );
        if (!exists) {
          registrations.push({ target: this, type, callback, capture });
          audit.active = registrations.length;
          audit.added += 1;
        }
      }
      return originalAdd.call(this, type, callback, options);
    };
    EventTarget.prototype.removeEventListener = function (
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (callback && (this === window || this === document)) {
        const capture = captureValue(options);
        const index = registrations.findIndex(
          (entry) =>
            entry.target === this &&
            entry.type === type &&
            entry.callback === callback &&
            entry.capture === capture,
        );
        if (index >= 0) {
          registrations.splice(index, 1);
          audit.active = registrations.length;
          audit.removed += 1;
        }
      }
      return originalRemove.call(this, type, callback, options);
    };
    (
      window as unknown as {
        __MANGAVAULT_LISTENER_AUDIT__?: typeof audit;
      }
    ).__MANGAVAULT_LISTENER_AUDIT__ = audit;
  });
  await page.goto("/");
  await expect(page.getByText("已加载 240 本漫画")).toBeVisible();

  const listenerBaseline = await page.evaluate(
    () =>
      (
        window as unknown as {
          __MANGAVAULT_LISTENER_AUDIT__?: { active: number };
        }
      ).__MANGAVAULT_LISTENER_AUDIT__?.active ?? 0,
  );
  const navigation = page.getByTestId("app-sidebar");
  const listenerSamples: number[] = [];

  for (let cycle = 0; cycle < 10; cycle += 1) {
    await navigation.getByRole("button", { name: "设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "常规" })).toBeVisible();
    await navigation.getByRole("button", { name: "漫画库", exact: true }).click();
    await expect(page.getByText("已加载 240 本漫画")).toBeVisible();
    await page.waitForTimeout(20);
    listenerSamples.push(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __MANGAVAULT_LISTENER_AUDIT__?: { active: number };
            }
          ).__MANGAVAULT_LISTENER_AUDIT__?.active ?? 0,
      ),
    );
  }

  expect(await commandCount(page, "get_format_capabilities")).toBe(0);
  await navigation.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "高级与诊断" }).click();
  await expect.poll(() => commandCount(page, "get_format_capabilities")).toBe(1);
  await navigation.getByRole("button", { name: "漫画库", exact: true }).click();
  await navigation.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "高级与诊断" }).click();
  expect(await commandCount(page, "get_format_capabilities")).toBe(1);
  await navigation.getByRole("button", { name: "漫画库", exact: true }).click();

  const result = await page.evaluate(() => {
    const calls = (
      window as unknown as {
        __MANGAVAULT_E2E__?: { calls: Array<{ cmd: string }> };
        __MANGAVAULT_LISTENER_AUDIT__?: { active: number; added: number; removed: number };
      }
    ).__MANGAVAULT_E2E__?.calls;
    const audit = (
      window as unknown as {
        __MANGAVAULT_LISTENER_AUDIT__?: { active: number; added: number; removed: number };
      }
    ).__MANGAVAULT_LISTENER_AUDIT__;
    return {
      activeListeners: audit?.active ?? 0,
      addedListeners: audit?.added ?? 0,
      removedListeners: audit?.removed ?? 0,
      capabilityCalls: calls?.filter((call) => call.cmd === "get_format_capabilities").length ?? 0,
      libraryBootstrapCalls: calls?.filter((call) => call.cmd === "list_libraries").length ?? 0,
    };
  });
  expect(result.activeListeners).toBeLessThanOrEqual(listenerBaseline);
  expect(listenerSamples.every((sample) => sample <= listenerBaseline)).toBe(true);
  expect(new Set(listenerSamples.slice(-3)).size).toBe(1);
  expect(result.capabilityCalls).toBe(1);
  expect(result.libraryBootstrapCalls).toBe(0);
  console.info(
    "UX-D navigation metrics",
    JSON.stringify({ listenerBaseline, listenerSamples, ...result }),
  );

  const activeLibraryButton = navigation.getByRole("button", { name: "漫画库", exact: true });
  await expect(activeLibraryButton).toHaveAttribute("aria-current", "page");
  await expect(activeLibraryButton).toBeEnabled();
  const callsBeforeActiveClick = await page.evaluate(
    () =>
      (
        window as unknown as {
          __MANGAVAULT_E2E__?: { calls: Array<unknown> };
        }
      ).__MANGAVAULT_E2E__?.calls.length ?? 0,
  );
  await activeLibraryButton.evaluate((button) =>
    button.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await page.waitForTimeout(50);
  const callsAfterActiveClick = await page.evaluate(
    () =>
      (
        window as unknown as {
          __MANGAVAULT_E2E__?: { calls: Array<unknown> };
        }
      ).__MANGAVAULT_E2E__?.calls.length ?? 0,
  );
  expect(callsAfterActiveClick).toBe(callsBeforeActiveClick);
});

test("shows actionable progress while the first large library scans", async ({ page }) => {
  await page.goto("/?empty-library=1");

  await expect(page.getByText("尚未添加漫画文件夹")).toBeVisible();
  await page.getByRole("button", { name: "添加漫画文件夹" }).first().click();

  await expect(page.getByTestId("scanning-state")).toBeVisible();
  await expect(page.getByText("正在建立漫画库")).toBeVisible();
  await expect(page.getByTestId("scanning-state").getByText("D:/MangaVaultFixtures")).toBeVisible();
  await expect(page.getByText("已发现")).toBeVisible();
  await expect(page.getByText("已导入")).toBeVisible();

  await page.getByTestId("scanning-state").getByRole("button", { name: "取消" }).click();
  await expect(
    page.getByTestId("scanning-state").getByRole("button", { name: "正在安全停止" }),
  ).toBeDisabled();
});

test("loads a large library incrementally while scrolling", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("已加载 240 本漫画")).toBeVisible();
  await expect(page.getByText("向下滚动继续加载")).toBeVisible();

  const scroller = page.locator(".thin-scrollbar");
  await expect(scroller).toHaveCount(1);
  await scroller.hover();
  await page.mouse.wheel(0, 100_000);

  await expect(page.getByText("已加载 242 本漫画")).toBeVisible();
  await expect(page.getByText("向下滚动继续加载")).toHaveCount(0);
});

test("filters library records by status and can clear the status filter", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("书籍状态").selectOption("missing");

  await expect(page.getByText("Quiet Signal")).toBeVisible();
  await expect(page.getByText("Cyber Orchard Vol. 1")).toHaveCount(0);

  await page.getByRole("button", { name: "清除" }).click();
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
});

test("previews before permanently cleaning deleted library records", async ({ page }) => {
  await page.goto("/?deleted-cleanup=1");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "存储与缓存" }).click();

  await page.getByRole("button", { name: "检查可清理项" }).click();
  await expect(page.getByText(/发现 3 本失效记录/)).toBeVisible();
  await page.getByRole("button", { name: "确认清理" }).click();
  await expect(page.getByText("失效数据已清理", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MANGAVAULT_E2E__?: { calls: Array<{ cmd: string }> };
            }
          ).__MANGAVAULT_E2E__?.calls.some((call) => call.cmd === "purge_deleted_books") ?? false,
      ),
    )
    .toBe(true);
});

test("shows persisted details for a scan failure on demand", async ({ page }) => {
  await page.goto("/?failed-scan=1");

  await page.getByRole("button", { name: "失败详情" }).click();
  await expect(page.getByRole("dialog", { name: "失败详情" })).toBeVisible();
  await expect(page.getByText("D:/MangaVaultFixtures/broken.cbz")).toBeVisible();
  await expect(page.getByText("zip error: invalid central directory")).toBeVisible();
});

test("applies interface layout settings without restarting", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();

  await page.getByRole("combobox", { name: "主侧栏" }).selectOption("compact");
  await expect(page.locator("aside")).toHaveCSS("width", "60px");

  await page.getByRole("button", { name: "漫画库", exact: true }).last().click();
  await page.getByLabel("网格密度").selectOption("compact");
  await page.getByLabel("封面比例").selectOption("square");
  await page.getByRole("button", { name: "常规" }).click();
  await page.getByRole("switch", { name: "快速操作" }).click();
  await expect(page.getByRole("switch", { name: "快速操作" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  await page.getByTitle("漫画库").click();
  await expect(page.locator(".virtuoso-grid-list")).toHaveClass(/grid-density-compact/);
  await expect(page.getByTestId("book-cover").first()).toHaveAttribute(
    "data-cover-ratio",
    "square",
  );

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("collapses the sidebar without reloading the library and restores the preference", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveCSS("width", "184px");
  await page.getByPlaceholder("搜索标题、作者、JM ID、标签或路径").fill("Cyber");
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__MANGAVAULT_E2E__?.calls.filter(
            (call) =>
              call.cmd === "list_books" &&
              (call.args as { query?: { search?: string } }).query?.search === "Cyber",
          ).length ?? 0,
      ),
    )
    .toBe(1);

  const callsBefore = await commandCount(page, "list_books");
  await page.getByTestId("sidebar-toggle").click();
  await expect(sidebar).toHaveAttribute("data-preferred-mode", "compact");
  await expect(sidebar).toHaveCSS("width", "60px");
  await expect(page.getByPlaceholder("搜索标题、作者、JM ID、标签或路径")).toHaveValue("Cyber");
  expect(await commandCount(page, "list_books")).toBe(callsBefore);
  await expect(sidebar.getByRole("button", { name: "漫画库", exact: true })).toHaveAttribute(
    "title",
    "漫画库",
  );
  await expect(sidebar.getByRole("button", { name: "设置", exact: true })).toHaveAttribute(
    "title",
    "设置",
  );

  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-preferred-mode", "compact");
  await expect(page.getByTestId("app-sidebar")).toHaveCSS("width", "60px");
});

test("temporarily constrains the sidebar only while the viewport is narrow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveAttribute("data-preferred-mode", "expanded");
  const settingWritesBefore = await settingWriteCount(page, "ui.layout.sidebar_mode");

  for (const width of [1024, 800]) {
    await page.setViewportSize({ width, height: 760 });
    await expect(sidebar).toHaveAttribute("data-effective-mode", "compact");
    await expect(sidebar).toHaveAttribute("data-responsive-constrained", "true");
    await expect(page.getByTestId("sidebar-toggle")).toBeDisabled();
  }
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(sidebar).toHaveAttribute("data-effective-mode", "expanded");
    await expect(sidebar).toHaveAttribute("data-preferred-mode", "expanded");
  }
  expect(await settingWriteCount(page, "ui.layout.sidebar_mode")).toBe(settingWritesBefore);
});

test("uses one activation contract for selection, Enter, and context menus", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-book-activation="1"]').first();

  await card.click();
  await expect(card).toHaveAttribute("data-book-selected", "true");
  await expect(page.locator("section[data-reader-presentation]")).toHaveCount(0);

  await card.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "打开", exact: true })).toBeVisible();
  await expect(card).toHaveAttribute("data-book-selected", "true");
  await page.keyboard.press("Escape");

  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("section[data-reader-presentation]")).toBeVisible();
  await expect.poll(() => commandCount(page, "record_reading_opened")).toBe(1);
});

test("keeps double-click consistent across grid, list, and series views", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-book-activation="1"]').first().dblclick();
  await expect(page.locator("section[data-reader-presentation]")).toBeVisible();
  await page.getByTitle("返回漫画库").click();

  await page.getByTitle("列表").click();
  const listTarget = page.locator('[data-book-activation="1"]').first();
  await listTarget.click();
  await expect(page.locator("section[data-reader-presentation]")).toHaveCount(0);
  await listTarget.getByTitle("收藏").click();
  await expect(page.locator("section[data-reader-presentation]")).toHaveCount(0);
  await listTarget.dblclick();
  await expect(page.locator("section[data-reader-presentation]")).toBeVisible();
  await page.getByTitle("返回漫画库").click();

  await page.getByTitle("系列").click();
  const seriesTarget = page.locator('[data-book-activation="1"]').first();
  await seriesTarget.click();
  await expect(page.locator("section[data-reader-presentation]")).toHaveCount(0);
  await seriesTarget.dblclick();
  await expect(page.locator("section[data-reader-presentation]")).toBeVisible();
});

test("applies and persists single-click opening without duplicate reader activation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "漫画库", exact: true }).last().click();
  await page.getByLabel("打开漫画的鼠标操作").selectOption("single");
  await page.getByTestId("app-sidebar").getByRole("button", { name: "漫画库" }).click();

  const card = page.locator('[data-book-activation="1"]').first();
  await card.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
  });
  await expect(page.locator("section[data-reader-presentation]")).toBeVisible();
  await expect.poll(() => commandCount(page, "record_reading_opened")).toBe(1);

  await page.getByTitle("返回漫画库").click();
  await page.reload();
  await page.locator('[data-book-activation="1"]').first().click();
  await expect(page.locator("section[data-reader-presentation]")).toBeVisible();
});

test("opens with touch but suppresses a dragged pointer activation", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-book-activation="1"]').first();
  await card.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    element.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        clientX: 30,
        clientY: 10,
      }),
    );
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
  });
  await expect(page.locator("section[data-reader-presentation]")).toHaveCount(0);

  await card.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 2,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 1 }));
  });
  await expect(page.locator("section[data-reader-presentation]")).toBeVisible();
});

test("resumes a recent reading item from its main navigation page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "最近阅读" }).click();

  await expect(page.getByRole("heading", { name: "最近阅读" })).toBeVisible();
  await page.getByRole("button", { name: "继续阅读" }).click();

  await expect(page.getByText("第 2 / 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "返回最近阅读" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MANGAVAULT_E2E__?: { calls: Array<{ cmd: string }> };
            }
          ).__MANGAVAULT_E2E__?.calls.some((call) => call.cmd === "record_reading_opened") ?? false,
      ),
    )
    .toBe(true);
});

test("uses structured settings categories and searches bilingual aliases", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();

  await expect(page.locator('[data-settings-section="general"]')).toBeVisible();
  await expect(page.locator('[data-shortcut-command="reader.bookmark"]')).toHaveCount(0);
  await page.getByLabel("搜索设置").fill("双击");
  await page.getByRole("option", { name: /打开漫画的鼠标操作/ }).click();
  await expect(page.locator('[data-settings-section="library"]')).toBeVisible();
  await expect(page.getByLabel("打开漫画的鼠标操作")).toBeFocused();

  await page.getByLabel("搜索设置").fill("backup");
  await expect(page.getByRole("option", { name: /备份数据库/ })).toBeVisible();

  await page.getByLabel("搜索设置").fill("不存在的设置词");
  await expect(page.getByText("没有匹配的设置")).toBeVisible();
});

test("discovers JMComic data and shows a read-only exact-path preview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "漫画库", exact: true }).last().click();

  await page.getByRole("button", { name: "自动发现" }).click();
  await expect(page.getByText("D:/JMComicFixture/data", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "预览关联" }).click();

  await expect(page.getByText("只读预览", { exact: true })).toBeVisible();
  await expect(page.getByText("来源记录: 2", { exact: true })).toBeVisible();
  await expect(page.getByText("精确匹配: 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "10001" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "10002" })).toBeVisible();
  await page.getByRole("button", { name: "导入 1 条 JM ID 关联" }).click();
  await expect(page.getByRole("status").getByText("新增 1，已有 0，冲突 0")).toBeVisible();

  const onlineSwitch = page.getByRole("switch", { name: "允许联网获取 JMComic 元数据" });
  await expect(onlineSwitch).not.toBeChecked();
  await onlineSwitch.click();
  await expect(onlineSwitch).toBeChecked();
  await expect(page.getByLabel("元数据服务")).toBeVisible();
  await page.getByRole("button", { name: "预览批量补全" }).click();
  await expect(page.getByText("将补全 1 本；0 本缓存仍有效，将跳过。")).toBeVisible();
  await page.getByRole("button", { name: "确认开始补全" }).click();
  await expect(page.getByRole("status").getByText("成功 1 本，失败 0 本")).toBeVisible();

  const commands = await page.evaluate(
    () => window.__MANGAVAULT_E2E__?.calls.map((call) => call.cmd) ?? [],
  );
  expect(commands.filter((command) => command === "discover_jmcomic_sources")).toHaveLength(1);
  expect(commands.filter((command) => command === "preview_jmcomic_matches")).toHaveLength(1);
  expect(commands.filter((command) => command === "import_jmcomic_identities")).toHaveLength(1);
  expect(commands.filter((command) => command === "refresh_jmcomic_metadata")).toHaveLength(0);
  expect(commands.filter((command) => command === "run_jmcomic_metadata_batch")).toHaveLength(1);
});

test("searches JM source metadata and keeps it separate from user metadata", async ({ page }) => {
  await page.goto("/");
  const search = page.getByPlaceholder("搜索标题、作者、JM ID、标签或路径");

  await search.fill("10001");
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
  await expect(page.getByText("Quiet Signal")).toHaveCount(0);

  await search.fill("");
  await page.getByLabel("来源分类").selectOption("Manga");
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
  await expect(page.getByText("Quiet Signal")).toHaveCount(0);

  await page.getByText("Cyber Orchard Vol. 1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑元数据" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑元数据" });
  await expect(dialog.getByText(/JM 10001/)).toBeVisible();
  await expect(dialog.getByText("JM Source Title")).toBeVisible();
  await expect(dialog.getByText("冒险")).toBeVisible();
  await expect(dialog.getByText("Manga", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "使用此值" }).first().click();
  await expect(dialog.getByLabel("标题")).toHaveValue("JM Source Title");
  await dialog.getByRole("button", { name: "取消" }).click();

  const updateCalls = await page.evaluate(
    () =>
      window.__MANGAVAULT_E2E__?.calls.filter((call) => call.cmd === "update_book_metadata") ?? [],
  );
  expect(updateCalls).toHaveLength(0);
});

test("keeps settings scoped to one category and preserves unsaved input on failure", async ({
  page,
}) => {
  await page.goto("/?setting-fail=library.open_mouse_action");
  await page.getByRole("button", { name: "设置" }).click();

  await expect(page.locator('[data-settings-section="general"]')).toBeVisible();
  await expect(page.locator('[data-settings-section="library"]')).toHaveCount(0);
  await page.getByRole("button", { name: "漫画库", exact: true }).last().click();
  await page.getByLabel("打开漫画的鼠标操作").selectOption("single");

  await expect(page.getByLabel("打开漫画的鼠标操作")).toHaveValue("single");
  await expect(
    page.getByTestId("settings-center").getByText("保存失败", { exact: true }),
  ).toBeVisible();
});

test("restores one settings category without touching user data", async ({ page }) => {
  await page.goto("/?protected-data=1");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "漫画库", exact: true }).last().click();
  await page.getByLabel("打开漫画的鼠标操作").selectOption("single");
  await expect(page.getByLabel("打开漫画的鼠标操作")).toHaveValue("single");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "恢复此分类默认" }).click();
  await expect(page.getByLabel("打开漫画的鼠标操作")).toHaveValue("double");
  expect(
    await page.evaluate(() => ({
      progress: window.__MANGAVAULT_E2E__?.progress?.currentPage,
      bookmarks: window.__MANGAVAULT_E2E__?.bookmarks.length,
    })),
  ).toEqual({ progress: 1, bookmarks: 1 });
});

test("keeps the local-data danger zone collapsed and separate from cache cleanup", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "备份与本地数据" }).click();

  const danger = page.locator("#setting-data-reset");
  await expect(danger).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "清除缓存" })).toHaveCount(0);
  await page.getByRole("button", { name: "存储与缓存" }).click();
  await expect(page.getByRole("button", { name: "清除缓存" })).toBeVisible();
  await expect(page.locator("#setting-data-reset")).toHaveCount(0);
});

test("keeps the settings center responsive from 800 to 1920 pixels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();

  for (const width of [800, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("settings-center")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    if (width < 1024) {
      await expect(
        page.getByTestId("settings-center").locator("main > label select"),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("navigation", { name: "设置分类" })).toBeVisible();
    }
  }
});

test("removes one Recent entry while preserving progress, bookmarks, and library books", async ({
  page,
}) => {
  await page.goto("/?protected-data=1");
  await page.getByRole("button", { name: "最近阅读" }).click();
  await page.locator('[data-book-activation="1"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "从最近阅读中移除" }).click();

  await expect(page.getByText("尚无最近阅读")).toBeVisible();
  const protectedCounts = await page.evaluate(() => ({
    progress: window.__MANGAVAULT_E2E__?.progress?.currentPage,
    bookmarks: window.__MANGAVAULT_E2E__?.bookmarks.length,
  }));
  expect(protectedCounts).toEqual({ progress: 1, bookmarks: 1 });
  await page.getByRole("button", { name: "前往漫画库" }).click();
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
});

test("clears all Recent history while preserving progress, bookmarks, and library books", async ({
  page,
}) => {
  await page.goto("/?protected-data=1");
  await page.getByRole("button", { name: "最近阅读" }).click();
  await page.getByRole("button", { name: "最近阅读菜单" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "清除全部最近阅读" }).click();

  await expect(page.getByText("尚无最近阅读")).toBeVisible();
  expect(
    await page.evaluate(() => ({
      progress: window.__MANGAVAULT_E2E__?.progress?.currentPage,
      bookmarks: window.__MANGAVAULT_E2E__?.bookmarks.length,
    })),
  ).toEqual({ progress: 1, bookmarks: 1 });
  await page.getByRole("button", { name: "前往漫画库" }).click();
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
});

test("deduplicates Recent history and supports search and time filters", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window.__MANGAVAULT_E2E__;
    if (!state) return;
    const current = state.history[0];
    state.history = [
      { ...current, pageIndex: 0, openedAt: new Date(Date.now() - 60_000).toISOString() },
      { ...current, pageIndex: 1, openedAt: new Date().toISOString() },
    ];
  });
  await page.getByRole("button", { name: "最近阅读" }).click();
  await expect(page.locator('[data-book-activation="1"]')).toHaveCount(1);
  await page.getByLabel("搜索最近阅读").fill("Cyber Orchard");
  await expect(page.locator('[data-book-activation="1"]')).toBeVisible();
  await page.getByLabel("筛选").selectOption("today");
  await expect(page.locator('[data-book-activation="1"]')).toBeVisible();
  await page.getByLabel("筛选").selectOption("7days");
  await expect(page.locator('[data-book-activation="1"]')).toBeVisible();
  await page.getByLabel("筛选").selectOption("30days");
  await expect(page.locator('[data-book-activation="1"]')).toBeVisible();
});

test("persists Recent view, sorting, and filtering across reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "最近阅读" }).click();
  await page.getByLabel("排序").selectOption("title");
  await page.getByLabel("筛选").selectOption("30days");
  await page.getByRole("button", { name: "网格视图" }).click();
  await expect(page.getByTestId("recent-grid")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "最近阅读" }).click();
  await expect(page.getByLabel("排序")).toHaveValue("title");
  await expect(page.getByLabel("筛选")).toHaveValue("30days");
  await expect(page.getByTestId("recent-grid")).toBeVisible();
});

test("keeps ten thousand Recent records paginated and virtualized", async ({ page }) => {
  await page.goto("/?recent-count=10000");
  await page.getByRole("button", { name: "最近阅读" }).click();
  await expect(page.getByTestId("recent-list")).toBeVisible();

  const renderedItems = await page
    .getByTestId("recent-page")
    .locator("[data-book-activation]")
    .count();
  expect(renderedItems).toBeLessThan(80);
  const recentCalls = await page.evaluate(
    () =>
      window.__MANGAVAULT_E2E__?.calls.filter((call) => call.cmd === "list_recent_reading") ?? [],
  );
  expect(recentCalls.length).toBeGreaterThan(0);
  expect(recentCalls[0].args).toMatchObject({ query: { limit: 80, offset: 0 } });
});

test("restores Recent view and filter after returning from Reader", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "最近阅读" }).click();
  await page.getByLabel("筛选").selectOption("unfinished");
  await page.getByRole("button", { name: "网格视图" }).click();
  await page.locator('[data-book-activation="1"]').dblclick();
  await expect(page.getByRole("button", { name: "返回最近阅读" })).toBeVisible();
  await page.getByRole("button", { name: "返回最近阅读" }).click();

  await expect(page.getByTestId("recent-grid")).toBeVisible();
  await expect(page.getByLabel("筛选")).toHaveValue("unfinished");
});

test("schedules and cancels a database restore without replacing the live database", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "备份与本地数据" }).click();

  await page.getByRole("button", { name: "准备恢复" }).click();
  await expect(page.getByText("确认使用此备份恢复？当前数据库会先创建安全副本。")).toBeVisible();
  await page.getByRole("button", { name: "下次启动时恢复" }).click();
  await expect(page.getByText("数据库恢复已安排，将在下次启动前执行。")).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MANGAVAULT_E2E__?: { calls: Array<{ cmd: string }> };
            }
          ).__MANGAVAULT_E2E__?.calls.some((call) => call.cmd === "schedule_database_restore") ??
          false,
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("heading", { name: "备份与本地数据" })).toBeVisible();
});

test("localizes managed backup reasons when the application language changes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("语言").selectOption("en-US");
  await page.getByRole("button", { name: "Backup & Local Data" }).click();
  await expect(page.getByRole("heading", { name: "Backup & Local Data" })).toBeVisible();
});

test("retries an interrupted scan from the library status strip", async ({ page }) => {
  await page.goto("/?failed-scan=1");

  await expect(page.getByText("意外中断")).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("排队中")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __MANGAVAULT_E2E__?: { calls: Array<{ cmd: string }> };
            }
          ).__MANGAVAULT_E2E__?.calls.some((call) => call.cmd === "retry_scan") ?? false,
      ),
    )
    .toBe(true);
});

test("imports, scans, searches, opens, turns pages, saves progress, and bookmarks", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
  await page.getByRole("button", { name: /导入文件夹/i }).click();
  await expect(page.getByText(/扫描中: 1\/2/i)).toBeVisible();
  await page.getByRole("button", { name: "导入文件", exact: true }).click();

  await page.getByPlaceholder("搜索标题、作者、JM ID、标签或路径").fill("Cyber");
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
  await expect(page.getByText("Quiet Signal")).toHaveCount(0);

  await page.getByTitle("列表").click();
  await page.getByText("Cyber Orchard Vol. 1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑元数据" }).click();
  await expect(page.getByRole("dialog", { name: "编辑元数据" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  await page.locator('[data-book-activation="1"]').first().dblclick();
  await expect(page.getByText("第 1 / 3")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("第 2 / 3")).toBeVisible();
  await expect(page.getByLabel("页码")).toHaveValue("2");

  await page.getByRole("button", { name: "书签", exact: true }).click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __MANGAVAULT_E2E__?: {
                  progress: { currentPage: number } | null;
                };
              }
            ).__MANGAVAULT_E2E__?.progress?.currentPage ?? null,
        ),
      { timeout: 2_000 },
    )
    .toBe(1);

  const e2eState = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __MANGAVAULT_E2E__?: {
          calls: Array<{ cmd: string }>;
          progress: { currentPage: number } | null;
          bookmarks: Array<{ pageIndex: number }>;
        };
      }
    ).__MANGAVAULT_E2E__;
    return {
      imported: state?.calls.some((call) => call.cmd === "import_folder") ?? false,
      importedFile: state?.calls.some((call) => call.cmd === "import_paths") ?? false,
      savedPage: state?.progress?.currentPage ?? null,
      bookmarkPage: state?.bookmarks[0]?.pageIndex ?? null,
    };
  });
  expect(e2eState).toEqual({
    imported: true,
    importedFile: true,
    savedPage: 1,
    bookmarkPage: 1,
  });

  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("语言").selectOption("en-US");
  await expect(page.getByText("Settings").first()).toBeVisible();
  await page.getByRole("button", { name: "About" }).click();
  await expect(page.getByText("Version", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "General" }).click();
  await page.getByLabel("Language").selectOption("zh-CN");
  await expect(page.getByText("设置").first()).toBeVisible();
});

test("throttles paged wheel turns and aligns double-page jumps", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-book-activation="1"]').first().dblclick();
  const pageNumber = page.getByLabel("页码");
  const reader = page.locator("main.reader-scrollbar");

  await reader.hover();
  await page.mouse.wheel(0, 80);
  await page.mouse.wheel(0, 80);
  await expect(pageNumber).toHaveValue("2");

  await page.getByLabel("阅读模式").selectOption("double");
  await pageNumber.fill("2");
  await pageNumber.press("Enter");
  await expect(page.getByText("第 1 / 3", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "图像调整" }).click();
  await expect(page.getByRole("dialog", { name: "图像调整" })).toBeVisible();
  await page.getByTitle("旋转").click();
  await expect(reader.locator("img").first()).toHaveAttribute(
    "style",
    /rotate\(90deg\) scale\(1\)/,
  );

  await page.getByTitle("放大").click();
  await expect(reader.locator("img").first()).toHaveAttribute(
    "style",
    /rotate\(90deg\) scale\(1\.1\)/,
  );
  await page.getByTitle("适应宽度").click();
  await expect(reader.locator("img").first()).toHaveClass(/max-h-\[calc\(100vh-7rem\)\]/);
  await page.getByTitle("适应高度").click();
  await expect(reader.locator("img").first()).toHaveClass(/max-w-none/);

  await page.getByTitle("阅读方向").click();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("第 3 / 3", { exact: true })).toBeVisible();
});

test("keeps the committed image visible until a delayed page is decoded and committed", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("mangavault.reader.performance", "1"));
  await page.goto("/?reader-pages=8&page-delay-map=1:8000");
  await page.locator('[data-book-activation="1"]').first().dblclick();
  const reader = page.locator("section[data-reader-presentation]");

  await expect(reader).toHaveAttribute("data-reader-committed-page", "0");
  await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();
  const loadErrors = await page.evaluate(
    () =>
      window.__MANGAVAULT_READER_PERFORMANCE__
        ?.snapshot()
        .filter((event) => event.name === "page-load-error") ?? [],
  );
  expect(loadErrors, "reader page loading diagnostics").toEqual([]);
  await page.keyboard.press("ArrowRight");
  await expect(reader).toHaveAttribute("data-reader-requested-page", "1");
  await expect(reader).toHaveAttribute("data-reader-loading-page", "1");

  for (let sample = 0; sample < 6; sample += 1) {
    await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();
    await expect(reader.locator('[data-reader-page="1"]')).toHaveCount(0);
    await page.waitForTimeout(80);
  }

  await expect(reader).toHaveAttribute("data-reader-committed-page", "1", { timeout: 12_000 });
  await expect(reader.locator('[data-reader-page="1"]')).toBeVisible();
});

test("arbitrates side paging and center double-click zoom without cross-triggering", async ({
  page,
}) => {
  await page.goto("/?reader-pages=8");
  await page.locator('[data-book-activation="1"]').first().dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const content = reader.locator("main.reader-scrollbar");
  const image = content.locator("img").first();
  const bounds = await content.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.click(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.5);
  await page.waitForTimeout(40);
  await page.mouse.click(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.5);
  await expect(reader).toHaveAttribute("data-reader-committed-page", "2");
  await expect(image).toHaveAttribute("style", /scale\(1\)/);

  await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.waitForTimeout(40);
  await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await expect(image).toHaveAttribute("style", /scale\(2\)/);
  await expect(reader).toHaveAttribute("data-reader-chrome", "all");

  await page.locator("nav").getByRole("button").last().click();
  await page.getByRole("button", { name: "键盘与鼠标" }).click();
  await page.locator('[data-gesture-setting="doubleClickZoom"]').click();
  await page.locator('[data-double-click-interval="250"]').click();
  await page.getByRole("button", { name: "最近阅读" }).click();
  await page.getByRole("button", { name: "继续阅读" }).click();
  await expect(reader).toHaveAttribute("data-reader-chrome", "all");
  await page.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await expect(reader).toHaveAttribute("data-reader-chrome", "hidden");
});

test("edits, applies, persists, conflicts, and resets shortcut bindings", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-book-activation="1"]').first().dblclick();
  await page.locator("nav").getByRole("button").last().click();
  await page.getByRole("button", { name: "键盘与鼠标" }).click();

  const bookmarkRow = page.locator('[data-shortcut-command="reader.bookmark"]');
  await bookmarkRow.locator('[data-shortcut-add="reader.bookmark"]').click();
  await page.keyboard.press("m");
  await expect(page.getByTestId("shortcut-recorder")).toHaveCount(0);
  await expect(bookmarkRow).toContainText("M");

  await page.getByRole("button", { name: "最近阅读" }).click();
  await page.getByRole("button", { name: "继续阅读" }).click();
  await page.keyboard.press("m");
  await expect
    .poll(() => page.evaluate(() => window.__MANGAVAULT_E2E__?.bookmarks.length ?? 0))
    .toBe(1);

  await page.reload();
  await page.locator("nav").getByRole("button").last().click();
  await page.getByRole("button", { name: "键盘与鼠标" }).click();
  await expect(page.locator('[data-shortcut-command="reader.bookmark"]')).toContainText("M");

  await page
    .locator('[data-shortcut-command="reader.bookmark"] [data-shortcut-add="reader.bookmark"]')
    .click();
  await page.keyboard.press("f");
  await expect(page.getByTestId("shortcut-recorder")).toContainText(/reader|阅读器/i);
  await page.getByTestId("shortcut-replace-conflict").click();
  await expect(page.getByTestId("shortcut-recorder")).toHaveCount(0);
  await expect(page.locator('[data-shortcut-command="reader.bookmark"]')).toContainText("F");

  await page.getByTestId("shortcut-reset-all").click();
  await expect(page.locator('[data-shortcut-command="reader.bookmark"]')).not.toContainText("M");
  await expect(page.locator('[data-shortcut-command="reader.fullscreen"]')).toContainText("F");
});

test("does not execute reader shortcuts while the page input is active", async ({ page }) => {
  await page.goto("/?reader-pages=8");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const input = reader.locator('footer input[type="number"]');

  await input.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  await expect(reader).toHaveAttribute("data-reader-committed-page", "0");
});

test("ignores an older delayed navigation after a newer page is ready", async ({ page }) => {
  await page.goto("/?reader-pages=8&page-delay-map=1:1200,2:120");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const observedCommits = await page.evaluateHandle(() => {
    const values: string[] = [];
    const target = document.querySelector("section[data-reader-presentation]");
    const observer = new MutationObserver(() => {
      values.push(target?.getAttribute("data-reader-committed-page") ?? "missing");
    });
    if (target)
      observer.observe(target, {
        attributes: true,
        attributeFilter: ["data-reader-committed-page"],
      });
    return { values, disconnect: () => observer.disconnect() };
  });

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(reader).toHaveAttribute("data-reader-requested-page", "2");
  await expect(reader).toHaveAttribute("data-reader-committed-page", "2");
  const commits = await observedCommits.evaluate((audit) => {
    audit.disconnect();
    return audit.values;
  });
  expect(commits).not.toContain("1");
});

test("commits a double-page spread only after both pages are decoded", async ({ page }) => {
  await page.goto("/?reader-pages=8&reader-mode=double&page-delay-map=2:120,3:1100");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const visiblePages = () =>
    reader
      .locator("[data-reader-page]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-reader-page")));

  await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();
  await expect.poll(visiblePages).toEqual(["0", "1"]);
  await page.keyboard.press("ArrowRight");
  await expect(reader).toHaveAttribute("data-reader-requested-page", "2");
  await page.waitForTimeout(350);
  expect(await visiblePages()).toEqual(["0", "1"]);
  await expect.poll(visiblePages).toEqual(["2", "3"]);
  await expect(reader).toHaveAttribute("data-reader-committed-page", "2");
});

test("keeps the old page and progress when the requested image fails", async ({ page }) => {
  await page.goto("/?reader-pages=5&page-fail=1");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");

  await page.keyboard.press("ArrowRight");
  await expect(reader).toHaveAttribute("data-reader-loading-page", "none");
  await expect(reader).toHaveAttribute("data-reader-committed-page", "0");
  await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__MANGAVAULT_E2E__?.progress)).toBeNull();
});

test("resolves control layout modes and keeps overlay viewport geometry invariant", async ({
  page,
}) => {
  await installFullscreenMock(page);
  await page.goto("/?reader-pages=4");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const image = reader.locator('[data-testid="reader-committed-frame"] img').first();

  await expect(reader).toHaveAttribute("data-reader-controls-layout", "reserved");
  await expect(image).toBeVisible();
  await page.keyboard.press("f");
  await expect(reader).toHaveAttribute("data-reader-controls-layout", "overlay");
  await expect(reader).toHaveAttribute("data-reader-chrome", "hidden");
  const hiddenBox = await image.boundingBox();
  await page.keyboard.press("h");
  await expect(reader).toHaveAttribute("data-reader-chrome", "all");
  const visibleBox = await image.boundingBox();
  expect(hiddenBox).toEqual(visibleBox);

  await page.goto("/?reader-pages=4&reader-controls-layout=overlay");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  await expect(reader).toHaveAttribute("data-reader-controls-layout", "overlay");

  await page.goto("/?reader-pages=4&reader-controls-layout=reserved");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  await page.keyboard.press("f");
  await expect(reader).toHaveAttribute("data-reader-controls-layout", "overlay");
  await page.keyboard.press("f");
  await expect(reader).toHaveAttribute("data-reader-controls-layout", "reserved");
});

test("virtualizes continuous pages with stable placeholders and bounded image loading", async ({
  page,
}) => {
  await page.goto("/?reader-pages=500&reader-mode=scroll&page-delay=80");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const scrollPages = reader.locator("[data-scroll-page]");

  await expect(scrollPages.first()).toBeVisible();
  await expect(scrollPages.first()).toHaveAttribute("data-scroll-page-height-stable", "true");
  expect(await scrollPages.count()).toBeLessThan(40);
  expect(await reader.locator("[data-reader-page]").count()).toBeLessThanOrEqual(12);

  const pageInput = page.getByLabel("页码");
  await pageInput.fill("250");
  await pageInput.press("Enter");
  await expect(reader).toHaveAttribute("data-reader-committed-page", "249");
  await expect(reader.locator('[data-scroll-page="249"]')).toHaveAttribute(
    "data-scroll-page-height-stable",
    "true",
  );
  expect(await scrollPages.count()).toBeLessThan(40);
});

test("collects bounded cold and hot reader pipeline metrics", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mangavault.reader.performance", "1"));
  await page.goto("/?reader-pages=100");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const pageInput = page.getByLabel("页码");
  await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();

  await page.evaluate(() => window.__MANGAVAULT_READER_PERFORMANCE__?.reset());
  for (const pageNumber of Array.from({ length: 20 }, (_, index) => 5 + index * 4)) {
    await pageInput.fill(String(pageNumber));
    await pageInput.press("Enter");
    await expect(reader).toHaveAttribute("data-reader-committed-page", String(pageNumber - 1));
  }
  const cold = await page.evaluate(() => window.__MANGAVAULT_READER_PERFORMANCE__?.summary());

  await page.evaluate(() => window.__MANGAVAULT_READER_PERFORMANCE__?.reset());
  for (let sample = 0; sample < 20; sample += 1) {
    await pageInput.fill("81");
    await pageInput.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => window.__MANGAVAULT_READER_PERFORMANCE__?.summary().sampleCount ?? 0),
      )
      .toBe(sample + 1);
  }
  const hot = await page.evaluate(() => window.__MANGAVAULT_READER_PERFORMANCE__?.summary());

  expect(cold?.sampleCount).toBe(20);
  expect(hot?.sampleCount).toBe(20);
  expect(cold?.commitP95Ms).not.toBeNull();
  expect(hot?.commitP95Ms).not.toBeNull();
  expect(hot?.cacheHitRate).toBe(1);
  console.log(`READER_PERF ${JSON.stringify({ cold, hot })}`);
});

test("virtualizes page thumbnails and keeps the current page located", async ({ page }) => {
  await page.goto("/?reader-pages=500");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const pageNumber = page.getByLabel("页码");
  await pageNumber.fill("401");
  await pageNumber.press("Enter");

  await page.getByRole("button", { name: "页面缩略图" }).click();
  const panel = page.getByRole("dialog", { name: "页面缩略图" });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[aria-current="page"]')).toHaveAttribute(
    "data-thumbnail-page",
    "400",
  );
  const renderedCount = await panel.locator("[data-thumbnail-page]").count();
  expect(renderedCount).toBeGreaterThan(0);
  expect(renderedCount).toBeLessThan(50);

  await panel.getByRole("button", { name: "第 402" }).click();
  await expect(pageNumber).toHaveValue("402");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("keeps legacy invert discoverable and lets the user disable it", async ({ page }) => {
  await page.goto("/?legacy-invert=1");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const readerImage = page.locator("main.reader-scrollbar img").first();
  await expect(readerImage).toHaveAttribute("style", /invert\(0\.92\)/);

  await page.getByRole("button", { name: "高级图像效果正在启用" }).click();
  const advanced = page.getByRole("dialog", { name: "高级图像效果" });
  await expect(advanced).toBeVisible();
  await advanced.getByRole("button", { name: "关闭反色" }).click();
  await expect(readerImage).not.toHaveAttribute("style", /invert\(0\.92\)/);
  await expect(page.getByRole("button", { name: "高级图像效果正在启用" })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__MANGAVAULT_E2E__?.settings["reader.night"]))
    .toBe(false);
});

test("resets image adjustments without changing reading state", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  await page.getByRole("button", { name: "书签", exact: true }).click();
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "图像调整" }).click();
  const panel = page.getByRole("dialog", { name: "图像调整" });
  await expect(panel.getByText("反色", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "旋转" }).click();
  await panel.getByRole("button", { name: "灰度" }).click();
  await expect(panel.getByText("已调整", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "恢复图像默认" }).click();
  const readerImage = page.locator("main.reader-scrollbar img").first();
  await expect(readerImage).toHaveAttribute("style", /rotate\(0deg\) scale\(1\)/);
  await expect(readerImage).not.toHaveAttribute("style", /grayscale\(1\)/);
  await expect(page.getByLabel("页码")).toHaveValue("1");
  await expect
    .poll(() => page.evaluate(() => window.__MANGAVAULT_E2E__?.bookmarks.length ?? 0))
    .toBe(1);
});

test("shows the reader guide once and reopens it from Help", async ({ page }) => {
  await installFullscreenMock(page);
  await page.goto("/?reader-tutorial=1");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();

  const tutorial = page.getByRole("dialog", { name: "阅读热区" });
  await expect(tutorial).toBeVisible();
  await expect(tutorial.getByText("单击中央区域显示或隐藏控制；左右区域用于翻页。")).toBeVisible();
  await expect(tutorial).toContainText("专注阅读会进入系统全屏并自动隐藏控制");
  await expect(page.getByText("上一页", { exact: true })).toBeVisible();
  await expect(page.getByText("下一页", { exact: true })).toBeVisible();
  await tutorial.getByRole("button", { name: "知道了，不再自动显示" }).click();
  await expect(tutorial).toHaveCount(0);

  await page.getByRole("button", { name: "进入专注阅读", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "已进入专注阅读" })).toHaveCount(0);
  const reader = page.locator("section[data-reader-presentation]");
  await revealReaderTopControls(page, reader);
  await page.getByRole("button", { name: "退出专注阅读", exact: true }).click();

  await page.getByRole("button", { name: "返回漫画库" }).click();
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  await expect(tutorial).toHaveCount(0);

  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "阅读操作指南" }).click();
  await expect(tutorial).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tutorial).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(() => window.__MANGAVAULT_E2E__?.settings["reader.tutorial_seen"] ?? false),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__MANGAVAULT_E2E__?.settings["reader.fullscreen_hint_seen"] ?? false,
      ),
    )
    .toBe(true);
});

test("shows the focus-reading exit hint once when the combined guide was already seen", async ({
  page,
}) => {
  await installFullscreenMock(page);
  await page.goto("/?focus-hint=1");
  await page.locator('[data-book-activation="1"]').first().dblclick();
  const reader = page.locator("section[data-reader-presentation]");

  await page.getByRole("button", { name: "进入专注阅读", exact: true }).click();
  const hint = page.getByRole("dialog", { name: "已进入专注阅读" });
  await expect(hint).toContainText("移动到顶部或底部可显示控制");
  await page.keyboard.press("Enter");
  await expect(hint).toHaveCount(0);

  await revealReaderTopControls(page, reader);
  await page.getByRole("button", { name: "退出专注阅读", exact: true }).click();
  await page.getByRole("button", { name: "进入专注阅读", exact: true }).click();
  await expect(hint).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.__MANGAVAULT_E2E__?.settings["reader.fullscreen_hint_seen"]),
    )
    .toBe(true);
});

test("supports one-click focus reading, mouse exit, and advanced layered presentation", async ({
  page,
}) => {
  await installFullscreenMock(page);
  await page.goto("/");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");

  await page.getByRole("button", { name: "进入专注阅读", exact: true }).click();
  await expect(reader).toHaveAttribute("data-reader-presentation", "focus");
  await expect(reader).toHaveAttribute("data-reader-focus-reading", "true");
  await expect(reader).toHaveAttribute("data-reader-controls-layout", "overlay");
  await expect(page.locator("nav")).toHaveCount(0);

  const bounds = await reader.boundingBox();
  if (!bounds) throw new Error("reader bounds unavailable");
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(2_750);
  await expect(reader).toHaveAttribute("data-reader-chrome", "hidden");
  await page.mouse.move(center.x, bounds.y + 4);
  await page.waitForTimeout(150);
  await expect(reader).toHaveAttribute("data-reader-chrome", "top");
  await page.keyboard.press("Escape");
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");
  await expect(reader).toHaveAttribute("data-reader-focus-reading", "false");
  await expect(reader).toHaveAttribute("data-reader-chrome", "all");
  await expect(page.locator("nav")).toBeVisible();

  await page.getByRole("button", { name: "进入专注阅读", exact: true }).click();
  await expect(reader).toHaveAttribute("data-reader-presentation", "focus");
  await revealReaderTopControls(page, reader);
  await page.getByRole("button", { name: "退出专注阅读", exact: true }).click();
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");

  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "仅系统全屏" }).click();
  await expect(reader).toHaveAttribute("data-reader-presentation", "fullscreen");
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "沉浸阅读" }).click();
  await expect(reader).toHaveAttribute("data-reader-presentation", "immersive");
  await page.keyboard.press("Escape");
  await expect(reader).toHaveAttribute("data-reader-presentation", "fullscreen");
  await expect(reader).toHaveAttribute("data-reader-chrome", "all");
  await page.keyboard.press("Escape");
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");

  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "返回漫画库" }).click();
  await expect(page.getByText("Cyber Orchard Vol. 1")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__MANGAVAULT_E2E__?.progress?.currentPage ?? null))
    .toBe(1);
});

test("applies normal, focus, and remembered Reader launch states after the first page is ready", async ({
  page,
}) => {
  await installFullscreenMock(page);
  await page.goto("/");
  const reader = page.locator("section[data-reader-presentation]");

  await page.locator('[data-book-activation="1"]').first().dblclick();
  await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");
  await page.getByRole("button", { name: "返回漫画库" }).click();

  await page.getByTestId("app-sidebar").getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "阅读器", exact: true }).click();
  await page.getByLabel("打开漫画后的界面状态").selectOption("focus");
  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "漫画库", exact: true })
    .click();
  await page.locator('[data-book-activation="1"]').first().dblclick();
  await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();
  await expect(reader).toHaveAttribute("data-reader-presentation", "focus");
  await revealReaderTopControls(page, reader);
  await page.getByRole("button", { name: "退出专注阅读" }).click();
  await page.getByRole("button", { name: "返回漫画库" }).click();

  await page.getByTestId("app-sidebar").getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name: "阅读器", exact: true }).click();
  await page.getByLabel("打开漫画后的界面状态").selectOption("remember");
  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "漫画库", exact: true })
    .click();
  await page.locator('[data-book-activation="1"]').first().dblclick();
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");
  await page.getByRole("button", { name: "进入专注阅读" }).click();
  await expect(reader).toHaveAttribute("data-reader-presentation", "focus");
  await revealReaderTopControls(page, reader);
  await page.getByRole("button", { name: "返回漫画库" }).click();

  await page.locator('[data-book-activation="1"]').first().dblclick();
  await expect(reader).toHaveAttribute("data-reader-presentation", "focus");
  await page.keyboard.press("Escape");
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");
  await page.getByRole("button", { name: "返回漫画库" }).click();
  await page.reload();
  await page.locator('[data-book-activation="1"]').first().dblclick();
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");
});

test("falls back to a clickable prompt when automatic focus fullscreen is rejected", async ({
  page,
}) => {
  await installFullscreenMock(page, { fail: true });
  await page.goto("/?reader-launch=focus");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");

  await expect(reader.locator('[data-reader-page="0"]')).toBeVisible();
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");
  await expect(reader).toHaveAttribute("data-reader-focus-transition", "idle");
  await expect(page.getByRole("dialog", { name: "需要确认进入专注阅读" })).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "需要确认进入专注阅读" })
      .getByRole("button", { name: "进入专注阅读" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__MANGAVAULT_FULLSCREEN_AUDIT__?.requests ?? 0))
    .toBe(1);
});

test("single-flights rapid focus requests and keeps overlay Escape priority", async ({ page }) => {
  await installFullscreenMock(page, { delayMs: 300 });
  await page.goto("/");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>("[data-focus-reading-button]");
    button?.click();
    button?.click();
  });
  await expect(reader).toHaveAttribute("data-reader-presentation", "focus");
  await expect
    .poll(() => page.evaluate(() => window.__MANGAVAULT_FULLSCREEN_AUDIT__?.requests ?? 0))
    .toBe(1);

  await revealReaderTopControls(page, reader);
  await page.getByRole("button", { name: "更多" }).click();
  await page.keyboard.press("Escape");
  await expect(reader).toHaveAttribute("data-reader-overlay", "none");
  await expect(reader).toHaveAttribute("data-reader-presentation", "focus");
  await page.keyboard.press("Escape");
  await expect(reader).toHaveAttribute("data-reader-presentation", "normal");
});

test("guards page hot zones against drag, double click, controls, and scroll mode", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();
  const reader = page.locator("section[data-reader-presentation]");
  const pageNumber = page.getByLabel("页码");
  const bounds = await reader.boundingBox();
  if (!bounds) throw new Error("reader bounds unavailable");
  const right = { x: bounds.x + bounds.width * 0.85, y: bounds.y + bounds.height / 2 };
  const left = { x: bounds.x + bounds.width * 0.15, y: bounds.y + bounds.height / 2 };

  await page.mouse.move(right.x, right.y);
  await page.mouse.down();
  await page.mouse.move(right.x - 40, right.y + 20);
  await page.mouse.up();
  await page.waitForTimeout(260);
  await expect(pageNumber).toHaveValue("1");

  await page.mouse.dblclick(right.x, right.y);
  await page.waitForTimeout(260);
  await expect(pageNumber).toHaveValue("3");
  await expect(page.getByText("100%", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "书签", exact: true }).click();
  await expect(pageNumber).toHaveValue("3");

  await page.getByLabel("阅读模式").selectOption("scroll");
  await page.waitForTimeout(260);
  const scrollPage = await pageNumber.inputValue();
  await page.mouse.click(left.x, left.y);
  await page.waitForTimeout(260);
  await expect(pageNumber).toHaveValue(scrollPage);

  await page.getByLabel("阅读模式").selectOption("single");
  await page.getByRole("button", { name: "阅读方向" }).click();
  await page.mouse.click(left.x, left.y);
  await page.waitForTimeout(260);
  await expect(pageNumber).toHaveValue(String(Math.min(3, Number(scrollPage) + 1)));
});

test("keeps metadata input open after a recoverable save failure", async ({ page }) => {
  await page.goto("/?metadata-fail=1");
  await page.getByText("Cyber Orchard Vol. 1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑元数据" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑元数据" });
  const title = dialog.getByLabel("标题");

  await title.fill("Still Here");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(dialog.getByRole("alert")).toContainText("元数据保存失败");
  await expect(title).toHaveValue("Still Here");
});

test("requests stable series ordering before rendering the series view", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("系列").click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const calls = (
          window as unknown as {
            __MANGAVAULT_E2E__?: {
              calls: Array<{ cmd: string; args: { query?: { view?: string } } }>;
            };
          }
        ).__MANGAVAULT_E2E__?.calls;
        return calls?.some(
          (call) => call.cmd === "list_books" && call.args.query?.view === "series",
        );
      }),
    )
    .toBe(true);
});

test("keeps Chinese reader controls named and reachable at compact desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  await page.goto("/");
  await page.getByText("Cyber Orchard Vol. 1").dblclick();

  await expect(page.getByRole("button", { name: "上一页" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下一页" })).toBeVisible();
  await expect(page.getByLabel("阅读模式")).toBeVisible();
  await expect(page.getByTitle("放大")).toBeVisible();
  await page.getByRole("button", { name: "更多" }).click();
  await expect(page.getByRole("menuitem", { name: "图像调整" })).toBeVisible();
  await expect(page.getByLabel("页码")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

async function commandCount(page: Page, command: string): Promise<number> {
  return page.evaluate(
    (target) => window.__MANGAVAULT_E2E__?.calls.filter((call) => call.cmd === target).length ?? 0,
    command,
  );
}

async function settingWriteCount(page: Page, key: string): Promise<number> {
  return page.evaluate(
    (target) =>
      window.__MANGAVAULT_E2E__?.calls.filter(
        (call) =>
          call.cmd === "set_setting" && (call.args as { key?: string } | undefined)?.key === target,
      ).length ?? 0,
    key,
  );
}
