import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ColorType, createChart, LineSeries, TickMarkType, type UTCTimestamp } from "lightweight-charts";
import { cx, SignGlyph, signClass } from "./ui";
import { formatCell, formatPointTime, seriesTimes, type SeriesPoint } from "./tools";
import { formatDate, formatPercent } from "./format";

/** The chart takes its colours and font from the theme variables, so both themes work. */
function chartStyle() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => css.getPropertyValue(name).trim();
  return {
    layout: {
      background: { type: ColorType.Solid, color: read("--color-inset") },
      textColor: read("--color-ink-muted"),
      fontFamily: getComputedStyle(document.body).fontFamily,
      attributionLogo: false,
    },
    grid: { vertLines: { color: read("--color-line") }, horzLines: { color: read("--color-line") } },
    rightPriceScale: { borderColor: read("--color-line") },
    timeScale: { borderColor: read("--color-line") },
    crosshair: {
      vertLine: { color: read("--color-line-hover"), labelBackgroundColor: read("--color-line-strong") },
      horzLine: { color: read("--color-line-hover"), labelBackgroundColor: read("--color-line-strong") },
    },
    up: read("--color-up"),
    down: read("--color-down"),
  };
}

type Hover = { index: number; x: number; width: number };
type Handle = { show: (index: number) => void; clear: () => void };

/** A line chart drawn by Lightweight Charts. Hover, touch or the arrow keys show the value and time at one point and its change since the start. */
export function LineChart({ points, label = "Price chart", format = formatCell }: { points: SeriesPoint[]; label?: string; format?: (value: number) => string }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<Handle | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const enough = points.length >= 2;

  useEffect(() => {
    const element = container.current;
    if (!element || !enough) return;
    const times = seriesTimes(points);
    const dateOnly = times !== null && times.every((time) => time % 86400 === 0);
    const data = points.map((point, index) => ({ time: (times ? times[index] : index + 1) as UTCTimestamp, value: point.value }));
    const indexByTime = new Map(data.map((item, index) => [item.time as number, index]));
    const up = points[points.length - 1].value >= points[0].value;
    const zone = dateOnly ? { timeZone: "UTC" } : {};
    const style = chartStyle();

    const chart = createChart(element, {
      autoSize: true,
      layout: { ...style.layout, fontSize: 11 },
      grid: style.grid,
      crosshair: style.crosshair,
      rightPriceScale: style.rightPriceScale,
      timeScale: {
        ...style.timeScale,
        timeVisible: !dateOnly,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown, type: TickMarkType) => {
          const value = time as number;
          if (!times) return formatPointTime(points[value - 1]?.label ?? "");
          const date = new Date(value * 1000);
          if (type === TickMarkType.Year) return formatDate(date, { year: "numeric", ...zone });
          if (type === TickMarkType.Month) return formatDate(date, { month: "short", ...zone });
          if (type === TickMarkType.DayOfMonth) return formatDate(date, { day: "numeric", month: "short", ...zone });
          return formatDate(date, { hour: "2-digit", minute: "2-digit", hour12: false });
        },
      },
      localization: {
        priceFormatter: (value: number) => formatRef.current(value),
        timeFormatter: (time: unknown) => {
          const value = time as number;
          if (!times) return formatPointTime(points[value - 1]?.label ?? "");
          return dateOnly ? formatDate(value * 1000, { dateStyle: "medium", timeZone: "UTC" }) : formatPointTime(String(value));
        },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });
    const series = chart.addSeries(LineSeries, { color: up ? style.up : style.down, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 5 });
    series.setData(data);
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      const index = param.time === undefined || !param.point ? undefined : indexByTime.get(param.time as number);
      setHover(index === undefined || !param.point ? null : { index, x: param.point.x, width: element.clientWidth });
    });
    handle.current = {
      show: (index) => {
        const item = data[index];
        chart.setCrosshairPosition(item.value, item.time, series);
        setHover({ index, x: chart.timeScale().timeToCoordinate(item.time) ?? 0, width: element.clientWidth });
      },
      clear: () => {
        chart.clearCrosshairPosition();
        setHover(null);
      },
    };

    const themed = new MutationObserver(() => {
      const next = chartStyle();
      chart.applyOptions({ layout: next.layout, grid: next.grid, crosshair: next.crosshair, rightPriceScale: next.rightPriceScale, timeScale: next.timeScale });
      series.applyOptions({ color: up ? next.up : next.down });
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      themed.disconnect();
      handle.current = null;
      chart.remove();
      setHover(null);
    };
  }, [points, enough]);

  if (!enough) return null;
  const last = points.length - 1;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const current = hover ? points[hover.index] : null;
  const share = hover && hover.width > 0 ? Math.max(0, Math.min(1, hover.x / hover.width)) : 0;
  const change = current && values[0] !== 0 ? ((current.value - values[0]) / Math.abs(values[0])) * 100 : null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const active = hover?.index ?? null;
    const next = event.key === "ArrowLeft" ? (active ?? last) - 1 : event.key === "ArrowRight" ? (active ?? -1) + 1 : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    handle.current?.show(Math.max(0, Math.min(last, next)));
  };

  return (
    <div>
      <div
        role="group"
        tabIndex={0}
        aria-label={`${label}. Use the left and right arrow keys to read single values.`}
        className="relative h-44 w-full overflow-hidden rounded-control bg-inset outline-none focus-visible:outline-2 focus-visible:outline-accent"
        onKeyDown={onKeyDown}
        onBlur={() => handle.current?.clear()}
      >
        <div ref={container} className="absolute inset-0" />
        {current && (
          <div
            className={cx(
              "pointer-events-none absolute top-1 z-10 grid gap-0.5 rounded-control border border-line-strong bg-raised px-2 py-1 text-caption whitespace-nowrap shadow-md",
              share < 0.2 ? "translate-x-1" : share > 0.8 ? "-translate-x-[calc(100%+0.25rem)]" : "-translate-x-1/2",
            )}
            style={{ left: `${share * 100}%` }}
          >
            <span className="text-ink-muted">{formatPointTime(current.label)}</span>
            <strong className="tabular-nums text-ink-strong">{format(current.value)}</strong>
            {change !== null && hover?.index !== 0 && (
              <span className={cx("tabular-nums", signClass(change, "text-ink-muted"))}>
                <SignGlyph value={change} />
                {formatPercent(change, 2, 2)} since start
              </span>
            )}
          </div>
        )}
      </div>
      <div aria-live="polite" className="sr-only">
        {current ? `${formatPointTime(current.label)}: ${format(current.value)}` : ""}
      </div>
      <div className="mt-1.5 flex justify-between gap-2.5 text-ink-muted">
        <span>{formatPointTime(points[0].label)}</span>
        <span>
          Low {format(min)} · High {format(max)}
        </span>
        <span>{formatPointTime(points[last].label)}</span>
      </div>
    </div>
  );
}
