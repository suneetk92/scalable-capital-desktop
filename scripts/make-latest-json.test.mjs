import { describe, expect, it } from "vite-plus/test";
import { buildIndexHtml, buildLatest, PLATFORMS } from "./make-latest-json.mjs";

const FILES = [
  "scalable-capital-desktop_0.2.0_x64-setup.exe",
  "scalable-capital-desktop_0.2.0_x64_en-US.msi",
  "scalable-capital-desktop-portable-windows-x64.exe",
  "scalable-capital-desktop_aarch64.app.tar.gz",
  "scalable-capital-desktop_x64.app.tar.gz",
  "scalable-capital-desktop_0.2.0_aarch64.dmg",
  "scalable-capital-desktop_0.2.0_x64.dmg",
  "scalable-capital-desktop_0.2.0_amd64.AppImage",
  "scalable-capital-desktop_0.2.0_aarch64.AppImage",
  "scalable-capital-desktop_0.2.0_amd64.deb",
];
const withSigs = (names) => [...names, ...names.filter((name) => !/\.(dmg|deb)$|portable/.test(name)).map((name) => `${name}.sig`)];
const options = { tag: "v0.2.0", baseUrl: "https://updates.example.com/scalable-capital-desktop/", now: new Date("2026-10-15T12:00:00Z") };
const read = (name) => `sig-of-${name}\n`;

describe("buildLatest", () => {
  it("writes Tauri's static latest.json shape for every platform", () => {
    const latest = buildLatest(withSigs(FILES), read, options);
    expect(latest.version).toBe("0.2.0");
    expect(latest.pub_date).toBe("2026-10-15T12:00:00.000Z");
    expect(Object.keys(latest.platforms).sort()).toEqual(Object.keys(PLATFORMS).sort());
    expect(latest.platforms["windows-x86_64-nsis"]).toEqual({
      signature: "sig-of-scalable-capital-desktop_0.2.0_x64-setup.exe.sig",
      url: "https://updates.example.com/scalable-capital-desktop/v0.2.0/scalable-capital-desktop_0.2.0_x64-setup.exe",
    });
    expect(latest.platforms["darwin-x86_64"].url).toMatch(/scalable-capital-desktop_x64\.app\.tar\.gz$/);
    expect(latest.platforms["linux-aarch64"].url).toMatch(/_aarch64\.AppImage$/);
    expect(latest.notes).toContain("https://updates.example.com/scalable-capital-desktop/index.html");
  });

  it("can point the installers at another host, such as GitHub Releases", () => {
    const latest = buildLatest(withSigs(FILES), read, {
      ...options,
      downloadBase: "https://github.com/owner/repo/releases/download/",
      notesUrl: "https://github.com/owner/repo/releases/tag/v0.2.0",
    });
    expect(latest.platforms["windows-x86_64-nsis"].url).toBe("https://github.com/owner/repo/releases/download/v0.2.0/scalable-capital-desktop_0.2.0_x64-setup.exe");
    expect(latest.notes).toBe("See https://github.com/owner/repo/releases/tag/v0.2.0 for the downloads.");
  });

  it("puts the release notes in front of the download link", () => {
    const latest = buildLatest(withSigs(FILES), read, { ...options, notesText: "\n- **New:** a thing.\n" });
    expect(latest.notes).toBe("- **New:** a thing.\n\nSee https://updates.example.com/scalable-capital-desktop/index.html for the downloads.");
  });

  it("needs no MSI for a pre-release, which the Windows MSI cannot carry", () => {
    const preFiles = withSigs(FILES.filter((name) => !name.includes(".msi")));
    const latest = buildLatest(preFiles, read, { ...options, tag: "v0.3.0-rc.1" });
    expect(latest.version).toBe("0.3.0-rc.1");
    expect(Object.keys(latest.platforms)).not.toContain("windows-x86_64-msi");
    expect(latest.platforms["windows-x86_64-nsis"].url).toContain("/v0.3.0-rc.1/");
    expect(() => buildLatest(preFiles, read, options)).toThrow(/windows-x86_64-msi/);
  });

  it("stops when a signature file is missing", () => {
    const names = withSigs(FILES).filter((name) => name !== "scalable-capital-desktop_0.2.0_amd64.AppImage.sig");
    expect(() => buildLatest(names, read, options)).toThrow(/linux-x86_64.*sig is missing/);
  });

  it("stops when an installer is missing or ambiguous", () => {
    expect(() =>
      buildLatest(
        withSigs(FILES).filter((name) => !name.includes(".msi")),
        read,
        options,
      ),
    ).toThrow(/windows-x86_64-msi/);
    expect(() => buildLatest(withSigs([...FILES, "other_x64-setup.exe"]), read, options)).toThrow(/windows-x86_64-nsis.*found 2/);
  });

  it("lists only the platforms that have a file when partial", () => {
    const windowsOnly = ["scalable-capital-desktop_0.2.0_x64-setup.exe", "scalable-capital-desktop_0.2.0_x64-setup.exe.sig"];
    const latest = buildLatest(windowsOnly, read, { ...options, partial: true });
    expect(Object.keys(latest.platforms)).toEqual(["windows-x86_64-nsis", "windows-x86_64"]);
    expect(latest.platforms["windows-x86_64"]).toEqual(latest.platforms["windows-x86_64-nsis"]);
    expect(() => buildLatest(windowsOnly, read, options)).toThrow(/windows-x86_64-msi/);
    expect(() => buildLatest(["scalable-capital-desktop_0.2.0_x64-setup.exe"], read, { ...options, partial: true })).toThrow(/sig is missing/);
    expect(() => buildLatest([], read, { ...options, partial: true })).toThrow(/No updatable installer/);
  });

  it("rejects an empty signature, a bad tag and a bad base URL", () => {
    expect(() => buildLatest(withSigs(FILES), () => "  \n", options)).toThrow(/empty/);
    expect(() => buildLatest(withSigs(FILES), read, { ...options, tag: "0.2.0" })).toThrow(/not a version/);
    expect(() => buildLatest(withSigs(FILES), read, { ...options, baseUrl: "http://updates.example.com/app" })).toThrow(/https folder URL/);
    expect(() => buildLatest(withSigs(FILES), read, { ...options, baseUrl: "https://updates.example.com/app?x=1" })).toThrow(/https folder URL/);
  });
});

describe("buildIndexHtml", () => {
  it("links every installer but no signature", () => {
    const html = buildIndexHtml(withSigs(FILES), options);
    expect(html).toContain('href="https://updates.example.com/scalable-capital-desktop/v0.2.0/scalable-capital-desktop_0.2.0_x64-setup.exe"');
    expect(html).toContain("scalable-capital-desktop-portable-windows-x64.exe");
    expect(html).toContain("scalable-capital-desktop_0.2.0_amd64.deb");
    expect(html).toContain("v0.2.0/SHA256SUMS.txt");
    expect(html).not.toContain(".sig");
  });
});
