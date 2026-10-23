import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { canMoveHolding, loadGroupOrder, orderGroups, parseGroupData, ungroupedGroup, UNGROUPED_ID, type SecurityGroup } from "./groups";

const ISINS = [
  "DE0007164600",
  "US0378331005",
  "IE00B4L5Y983",
  "IE00BK5BQT80",
  "LU0290358497",
  "US5949181045",
  "FR0000120073",
  "NL0010273215",
  "CH0012005267",
  "GB00B03MLX29",
  "JP3633400001",
  "US88160R1014",
];

/** Shape taken from a real "Data diagnostics" export of `list_portfolio_groups`. */
const sample = {
  "list_portfolio_groups:p1": {
    portfolioId: "p1",
    canCreateAdditionalGroup: true,
    items: [{ name: "Leverage", groupId: "g1", holdings: [{ isin: "XS3306516876" }] }],
    ungroupedHoldings: ISINS.map((isin) => ({ isin })),
  },
};

describe("parseGroupData", () => {
  it("reads the Leverage group and the 12 ungrouped holdings", () => {
    const data = parseGroupData(sample);
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0]).toMatchObject({ id: "g1", name: "Leverage", portfolioId: "p1", isins: ["XS3306516876"] });
    expect(data.ungrouped).toHaveLength(1);
    expect(data.ungrouped[0].portfolioId).toBe("p1");
    expect(data.ungrouped[0].holdings.map((holding) => holding.isin)).toEqual(ISINS);
    expect(data.canCreate).toBe(true);
  });

  it("parses answers that arrive as JSON text", () => {
    const data = parseGroupData({ "list_portfolio_groups:p1": JSON.stringify(sample["list_portfolio_groups:p1"]) });
    expect(data.groups.map((group) => group.name)).toEqual(["Leverage"]);
    expect(data.ungrouped[0].holdings).toHaveLength(12);
  });

  it("works out the Since buy amount from the value when only a percentage is reported", () => {
    const data = parseGroupData({
      "list_portfolio_groups:p1": { items: [{ name: "G", groupId: "g1", holdings: [{ isin: "XS3306516876" }], performance: { valuation: 120, sinceBuy: { performance: 0.2 } } }] },
    });
    expect(data.groups[0].sinceBuyAbsolute).toBeCloseTo(20);
    expect(data.groups[0].sinceBuyPerformance).toBe(0.2);
  });

  it("finds Since buy in a performance list and ignores a holding\'s own figure", () => {
    const performance = [
      { timeframe: "ONE_WEEK", performance: 0.5, simpleAbsoluteReturn: 99 },
      { timeframe: "SINCE_BUY", performance: 0.1, simpleAbsoluteReturn: 12 },
    ];
    const data = parseGroupData({
      "list_portfolio_groups:p1": {
        items: [
          { name: "A", groupId: "a", holdings: [{ isin: "XS3306516876" }], performance },
          { name: "B", groupId: "b", holdings: [{ isin: "DE000BASF111", sinceBuy: { simpleAbsoluteReturn: 7 } }] },
        ],
      },
    });
    expect(data.groups[0].sinceBuyAbsolute).toBe(12);
    expect(data.groups[0].sinceBuyPerformance).toBe(0.1);
    expect(data.groups[1].sinceBuyAbsolute).toBeNull();
  });

  it("skips error entries and tolerates missing input", () => {
    expect(parseGroupData(undefined)).toEqual({ groups: [], ungrouped: [], canCreate: null });
    expect(parseGroupData({ "list_portfolio_groups:p1:error": "boom" }).groups).toEqual([]);
  });

  it("falls back to ISINs found anywhere inside a group without a holdings list", () => {
    const data = parseGroupData({ "x:p2": { items: [{ name: "Tech", id: "g2", members: undefined, extra: { deep: ["US0378331005"] } }] } });
    expect(data.groups[0].isins).toEqual(["US0378331005"]);
    expect(data.groups[0].portfolioId).toBe("p2");
  });

  it("does not list the same group twice and ANDs canCreateAdditionalGroup", () => {
    const group = { name: "A", groupId: "g1" };
    const data = parseGroupData({
      "x:p1": { items: [group], canCreateAdditionalGroup: true },
      "x:p2": { items: [group], canCreateAdditionalGroup: false },
    });
    expect(data.groups).toHaveLength(1);
    expect(data.canCreate).toBe(false);
  });
});

describe("ungroupedGroup", () => {
  it("collects the 12 ungrouped holdings into one default group", () => {
    const group = ungroupedGroup(parseGroupData(sample));
    expect(group).toMatchObject({ id: UNGROUPED_ID, name: "Default", portfolioId: "p1", isDefault: true });
    expect(group?.isins).toEqual(ISINS);
  });

  it("is null when every holding is in a group", () => {
    expect(ungroupedGroup(parseGroupData(undefined))).toBeNull();
  });
});

describe("group order", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stored = (value: string | null) => vi.stubGlobal("window", { localStorage: { getItem: () => value, setItem: () => {} } });

  it("reads the saved ids, without duplicates or non-strings", () => {
    stored(JSON.stringify(["g2", 5, "g1", "g2", ""]));
    expect(loadGroupOrder()).toEqual(["g2", "g1"]);
  });

  it("is empty without a window or with broken data", () => {
    expect(loadGroupOrder()).toEqual([]);
    stored("{not json");
    expect(loadGroupOrder()).toEqual([]);
    stored(JSON.stringify({ g1: 1 }));
    expect(loadGroupOrder()).toEqual([]);
  });

  it("puts saved groups first and keeps Scalable's order for the rest", () => {
    const groups = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(orderGroups(groups, ["c", "gone", "a"]).map((group) => group.id)).toEqual(["c", "a", "b", "d"]);
    expect(orderGroups(groups, [])).toBe(groups);
  });
});

describe("canMoveHolding", () => {
  const group = (id: string, isins: string[], portfolioId = "p1"): SecurityGroup => ({
    id,
    name: id,
    description: "",
    portfolioId,
    isins,
    portfolioIds: [],
    holdings: [],
    valuation: null,
    currency: "EUR",
    sinceBuyPerformance: null,
    sinceBuyAbsolute: null,
    pendingOrders: null,
    savingsPlansAmount: null,
  });
  const row = { isin: "US0378331005", portfolioId: "p1" };
  const tech = group("tech", [row.isin]);
  const cars = group("cars", []);
  const all = () => true;
  const only = (tool: string) => (name: string) => name === tool;

  it("moves between two groups with both tools", () => {
    expect(canMoveHolding(row, tech, cars, all)).toBe(true);
    expect(canMoveHolding(row, tech, cars, only("add_portfolio_group_holdings"))).toBe(false);
    expect(canMoveHolding(row, tech, cars, only("remove_portfolio_group_holdings"))).toBe(false);
  });

  it("only adds from Default and only removes into Default", () => {
    const fallback = { ...cars, id: UNGROUPED_ID, isDefault: true };
    expect(canMoveHolding(row, null, cars, only("add_portfolio_group_holdings"))).toBe(true);
    expect(canMoveHolding(row, fallback, cars, only("add_portfolio_group_holdings"))).toBe(true);
    expect(canMoveHolding(row, tech, null, only("remove_portfolio_group_holdings"))).toBe(true);
    expect(canMoveHolding(row, tech, fallback, only("add_portfolio_group_holdings"))).toBe(false);
    expect(canMoveHolding(row, null, fallback, all)).toBe(false);
  });

  it("refuses the same group, a row without ISIN and a group of another portfolio", () => {
    expect(canMoveHolding(row, tech, tech, all)).toBe(false);
    expect(canMoveHolding({ ...row, isin: "" }, tech, cars, all)).toBe(false);
    expect(canMoveHolding(row, tech, group("other", [], "p2"), all)).toBe(false);
  });

  it("needs no add when the target already holds it, but then needs a source", () => {
    const both = group("both", [row.isin]);
    expect(canMoveHolding(row, tech, both, only("remove_portfolio_group_holdings"))).toBe(true);
    expect(canMoveHolding(row, null, both, all)).toBe(false);
  });
});
