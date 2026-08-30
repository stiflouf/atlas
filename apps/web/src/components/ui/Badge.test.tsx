import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Badge from "./Badge";

describe("Badge", () => {
  it("variant default (explicite) : tokens neutres + rayon 6 px", () => {
    const html = renderToStaticMarkup(<Badge variant="default">En commercialisation</Badge>);
    expect(html).toContain("En commercialisation");
    expect(html).toContain("bg-border-subtle");
    expect(html).toContain("text-text-secondary");
    expect(html).toContain("rounded-md");
  });

  it("variant accent : bg-accent-light conservé, text-ink-900 (jamais action-primary sur un badge statique)", () => {
    const html = renderToStaticMarkup(<Badge variant="accent">Offre en cours</Badge>);
    expect(html).toContain("Offre en cours");
    expect(html).toContain("bg-accent-light");
    expect(html).toContain("text-ink-900");
    expect(html).toContain("rounded-md");
  });

  it("variant danger : tokens status-danger canoniques", () => {
    const html = renderToStaticMarkup(<Badge variant="danger">Expiré</Badge>);
    expect(html).toContain("Expiré");
    expect(html).toContain("bg-status-danger-subtle");
    expect(html).toContain("text-status-danger");
    expect(html).toContain("rounded-md");
  });

  it("variant success : tokens status-success canoniques", () => {
    const html = renderToStaticMarkup(<Badge variant="success">Compromis signé</Badge>);
    expect(html).toContain("Compromis signé");
    expect(html).toContain("bg-status-success-subtle");
    expect(html).toContain("text-status-success");
    expect(html).toContain("rounded-md");
  });

  it("variant warning : tokens status-warning canoniques (jamais danger — ADR-029)", () => {
    const html = renderToStaticMarkup(<Badge variant="warning">À vérifier</Badge>);
    expect(html).toContain("À vérifier");
    expect(html).toContain("bg-status-warning-subtle");
    expect(html).toContain("text-status-warning");
    expect(html).toContain("rounded-md");
  });

  it("variant muted : bg-page volontairement conservé, text-text-muted", () => {
    const html = renderToStaticMarkup(<Badge variant="muted">Archivé le 12 mars 2026</Badge>);
    expect(html).toContain("Archivé le 12 mars 2026");
    expect(html).toContain("bg-page");
    expect(html).toContain("text-text-muted");
    expect(html).toContain("rounded-md");
  });

  it("variant omis : repli sur default", () => {
    const html = renderToStaticMarkup(<Badge>Sans variant</Badge>);
    expect(html).toContain("Sans variant");
    expect(html).toContain("bg-border-subtle");
    expect(html).toContain("text-text-secondary");
  });
});
