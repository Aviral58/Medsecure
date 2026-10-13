import { formatIsoDate } from "../lib/format.js";

// One test followed across reports, drawn as a line.
// The shaded band is the normal range printed on the reports, so a point
// outside the band is a result outside the range. Every point is labelled
// with its value, and the same numbers are in the table under the chart, so
// nothing depends on colour alone.

const WIDTH = 520;
const HEIGHT = 200;
const LEFT = 12;
const RIGHT = 50;
const TOP = 30;
const BOTTOM = 36;

const trim = (number) => String(Number(number.toFixed(2)));

export default function TrendChart({ test }) {
  const points = test.points;
  const values = points.map((point) => point.value);
  // The range of the newest report is the one drawn.
  const { low, high } = test.latest;

  let min = Math.min(...values, low ?? Infinity);
  let max = Math.max(...values, high ?? -Infinity);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.16;
  min -= pad;
  max += pad;

  const times = points.map((point) => Date.parse(point.date));
  const span = times[times.length - 1] - times[0];
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const y = (value) => TOP + (1 - (value - min) / (max - min)) * plotHeight;

  // Points are placed by date. If that would put two of them on top of each
  // other (reports a few days apart, or on the same day), they are spaced
  // evenly instead, still in date order.
  const byDate = points.map((_, index) => (span > 0 ? LEFT + 24 + ((times[index] - times[0]) / span) * (plotWidth - 48) : NaN));
  const crowded = span <= 0 || byDate.some((position, index) => index > 0 && position - byDate[index - 1] < 40);
  const xs = crowded ? points.map((_, index) => LEFT + 24 + (points.length === 1 ? 0.5 : index / (points.length - 1)) * (plotWidth - 48)) : byDate;

  const bandTop = high !== null && high !== undefined ? y(high) : TOP;
  const bandBottom = low !== null && low !== undefined ? y(low) : TOP + plotHeight;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${xs[index].toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const showEveryDate = points.length <= 5;

  return (
    <figure className="trend-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${test.test} in ${points.length} reports: ${values.map(trim).join(", ")} ${test.unit}`}>
        <rect className="trend-band" x={LEFT} y={bandTop} width={plotWidth} height={Math.max(0, bandBottom - bandTop)} rx="3" />
        {high !== null && high !== undefined && (
          <>
            <line className="trend-bound" x1={LEFT} x2={LEFT + plotWidth} y1={bandTop} y2={bandTop} />
            <text className="trend-bound-label" x={LEFT + plotWidth + 8} y={bandTop + 4}>
              {trim(high)}
            </text>
          </>
        )}
        {low !== null && low !== undefined && (
          <>
            <line className="trend-bound" x1={LEFT} x2={LEFT + plotWidth} y1={bandBottom} y2={bandBottom} />
            <text className="trend-bound-label" x={LEFT + plotWidth + 8} y={bandBottom + 4}>
              {trim(low)}
            </text>
          </>
        )}
        <line className="trend-axis" x1={LEFT} x2={LEFT + plotWidth} y1={TOP + plotHeight} y2={TOP + plotHeight} />

        <path className="trend-line" d={line} />
        {points.map((point, index) => {
          const cy = y(point.value);
          const outside = point.status !== "normal";
          return (
            <g key={`${point.recordId}-${index}`}>
              <circle className={outside ? "trend-point trend-point-outside" : "trend-point"} cx={xs[index]} cy={cy} r="5.5" />
              <text className={outside ? "trend-value trend-value-outside" : "trend-value"} x={xs[index]} y={cy - 12} textAnchor="middle">
                {trim(point.value)}
              </text>
              {(showEveryDate || index === 0 || index === points.length - 1) && (
                <text className={index === 0 || index === points.length - 1 ? "trend-date" : "trend-date trend-date-middle"} x={xs[index]} y={HEIGHT - 12} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} dx={index === 0 ? -8 : index === points.length - 1 ? 8 : 0}>
                  {formatIsoDate(point.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>
        <span>
          <span className="trend-key trend-key-band" /> Normal range on the report: {test.latest.reference} {test.unit}
        </span>
        {points.some((point) => point.status !== "normal") && (
          <span>
            <span className="trend-key trend-key-outside" /> Outside the range
          </span>
        )}
      </figcaption>
    </figure>
  );
}
