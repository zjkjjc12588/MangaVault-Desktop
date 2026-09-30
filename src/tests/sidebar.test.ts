import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../components/Sidebar";

describe("sidebar", () => {
  afterEach(cleanup);

  it("shows only public primary navigation and keeps the active item focusable", () => {
    const onRoute = vi.fn();
    const view = render(
      createElement(Sidebar, {
        route: "library",
        onRoute,
        preferredMode: "expanded",
        onPreferredModeChange: vi.fn(),
      }),
    );

    expect(view.getByRole("button", { name: "漫画库" })).toHaveAttribute("aria-current", "page");
    expect(view.getByRole("button", { name: "最近阅读" })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "阅读器" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "漫画库" }));
    expect(onRoute).not.toHaveBeenCalled();
  });

  it("provides an accessible manual collapse control and compact tooltips", () => {
    const onMode = vi.fn();
    const props = {
      route: "library" as const,
      onRoute: vi.fn(),
      preferredMode: "expanded" as const,
      onPreferredModeChange: onMode,
    };
    const view = render(createElement(Sidebar, props));

    fireEvent.click(view.getByTestId("sidebar-toggle"));
    expect(onMode).toHaveBeenCalledWith("compact");

    view.rerender(createElement(Sidebar, { ...props, preferredMode: "compact" }));
    expect(view.getByTestId("app-sidebar")).toHaveAttribute("data-effective-mode", "compact");
    expect(view.getByRole("button", { name: "漫画库" })).toHaveAttribute("title", "漫画库");
    expect(view.getByRole("button", { name: "最近阅读" })).toHaveAttribute("title", "最近阅读");
    expect(view.getByRole("button", { name: "设置" })).toHaveAttribute("title", "设置");
    expect(view.getByTestId("sidebar-toggle")).toHaveAttribute("aria-label", "展开侧边栏");
  });
});
