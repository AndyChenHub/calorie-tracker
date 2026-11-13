import React from 'react';
import { StyleSheet, View } from 'react-native';
import { formatNum } from '../constants/plateCatalog';
import {
  computeWeekBarsGeometry,
  computeWeightChartGeometry,
  getDefaultStrokeWidth,
  PlateIconProps,
  ProgressRingProps,
  WeeklyMacroBarsChartProps,
  WeightAreaChartProps,
} from './plateChartMath';

export type {
  PlateIconName,
  PlateIconProps,
  ProgressRingProps,
  WeekBarDayPoint,
  WeeklyMacroBarsChartProps,
  WeightAreaChartProps,
} from './plateChartMath';

export function PlateIcon({
  name,
  size = 20,
  color = '#0B0B0C',
  fill = 'none',
  strokeWidth,
}: PlateIconProps) {
  const sw = strokeWidth ?? getDefaultStrokeWidth(name);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {name === 'flame' ? (
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      ) : null}
      {name === 'plus' ? <path d="M12 5v14M5 12h14" /> : null}
      {name === 'minus' ? <path d="M5 12h14" /> : null}
      {name === 'home' ? (
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      ) : null}
      {name === 'chart' ? (
        <>
          <path d="M3 3v18h18" />
          <path d="M18 17V9M13 17V5M8 17v-3" />
        </>
      ) : null}
      {name === 'sliders' ? (
        <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
      ) : null}
      {name === 'camera' ? (
        <>
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
          <circle cx="12" cy="13" r="3" />
        </>
      ) : null}
      {name === 'scan' ? (
        <>
          <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
          <path d="M7 12h10" />
        </>
      ) : null}
      {name === 'barcode' ? (
        <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14M21 5v14" />
      ) : null}
      {name === 'label' ? (
        <>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h5" />
        </>
      ) : null}
      {name === 'bookmark' ? (
        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      ) : null}
      {name === 'search' ? (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </>
      ) : null}
      {name === 'dumbbell' ? (
        <path d="m6.5 6.5 11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7" />
      ) : null}
      {name === 'x' ? <path d="M18 6 6 18M6 6l12 12" /> : null}
      {name === 'check' ? <path d="M20 6 9 17l-5-5" /> : null}
      {name === 'zap' ? <path d="M13 2 3 14h9l-1 8 10-12h-9z" /> : null}
      {name === 'image' ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
        </>
      ) : null}
      {name === 'back' ? <path d="m15 18-6-6 6-6" /> : null}
      {name === 'activity' ? <path d="M22 12h-4l-3 9L9 3l-3 9H2" /> : null}
      {name === 'drop' ? (
        <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z" />
      ) : null}
      {name === 'drum' ? (
        <>
          <path d="M15.4 15.63a7.88 6 135 1 1 6.23-6.23 4.3 3.3 135 0 0-6.23 6.23" />
          <path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" />
        </>
      ) : null}
      {name === 'wheat' ? (
        <>
          <path d="M2 22 16 8" />
          <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" />
          <path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" />
          <path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" />
          <path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z" />
        </>
      ) : null}
      {name === 'heart' ? (
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      ) : null}
      {name === 'sparkle' ? (
        <>
          <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" />
          <path d="M19 15l.7 2.1 2.3.9-2.3.7L19 21l-.7-2.3L16 18l2.3-.9z" />
        </>
      ) : null}
      {name === 'swap' ? <path d="m7 15 5 5 5-5M7 9l5-5 5 5" /> : null}
      {name === 'trash' ? (
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
      ) : null}
      {name === 'scale' ? (
        <>
          <path d="M12 3v3M5 21h14a2 2 0 0 0 2-2l-1.5-9a2 2 0 0 0-2-1.7h-11a2 2 0 0 0-2 1.7L3 19a2 2 0 0 0 2 2z" />
          <path d="m12 13 2-3" />
        </>
      ) : null}
      {name === 'down' ? <path d="M12 5v14M19 12l-7 7-7-7" /> : null}
      {name === 'walk' ? (
        <>
          <circle cx="13" cy="4" r="2" />
          <path d="m9 20 3-6 3 3v4M7 12l3-4 4 1 3 3M10 8l-1 5" />
        </>
      ) : null}
    </svg>
  );
}

export function ProgressRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor = '#EFEFF2',
  dashedTrack,
  children,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, progress || 0));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const h = size / 2;
  const offset = c * (1 - clamped);

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block', position: 'absolute', inset: 0 }}
      >
        <circle
          cx={h}
          cy={h}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeDasharray={dashedTrack}
        />
        <circle
          cx={h}
          cy={h}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap={clamped > 0.01 ? 'round' : 'butt'}
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${h} ${h})`}
          style={{
            transition: 'stroke-dashoffset 0.85s cubic-bezier(0.2, 0.9, 0.2, 1)',
          }}
        />
      </svg>
      {children ? <View style={styles.ringCenter}>{children}</View> : null}
    </View>
  );
}

export function WeightAreaChart(props: WeightAreaChartProps) {
  const { goalWeight } = props;
  const g = computeWeightChartGeometry(props);

  return (
    <View style={styles.chartWrap}>
      <svg
        viewBox={`0 0 ${g.W} ${g.H}`}
        width="100%"
        height={170}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="wgWeb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0B0B0C" stopOpacity="0.14" />
            <stop offset="1" stopColor="#0B0B0C" stopOpacity="0" />
          </linearGradient>
        </defs>

        {g.gridLines.map((gl, idx) => (
          <React.Fragment key={idx}>
            <line
              x1={g.L}
              x2={g.W}
              y1={gl.y}
              y2={gl.y}
              stroke="#F0F0F2"
              strokeWidth={1}
            />
            <text
              x={0}
              y={gl.y + 3.5}
              fill="#B9B9BF"
              fontSize={10.5}
              fontWeight={500}
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {gl.label}
            </text>
          </React.Fragment>
        ))}

        {g.xLabels.map((xl) => (
          <text
            key={xl.label}
            x={xl.x}
            y={xl.y}
            fill="#B9B9BF"
            fontSize={10.5}
            fontWeight={500}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {xl.label}
          </text>
        ))}

        <line
          x1={g.L}
          x2={g.W}
          y1={g.goalY}
          y2={g.goalY}
          stroke="#34C77B"
          strokeDasharray="4 4"
          strokeWidth={1.5}
        />
        <text
          x={g.W - 46}
          y={g.goalY - 6}
          fill="#34C77B"
          fontSize={10.5}
          fontWeight={600}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {`Goal ${goalWeight}`}
        </text>

        {g.hasTrendLine ? (
          <>
            <path d={g.areaPath} fill="url(#wgWeb)" />
            <path
              d={g.linePath}
              fill="none"
              stroke="#0B0B0C"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          </>
        ) : null}
        <circle
          cx={g.last[0]}
          cy={g.last[1]}
          r={5}
          fill="#FFFFFF"
          stroke="#0B0B0C"
          strokeWidth={2.5}
        />
      </svg>
    </View>
  );
}

export function WeeklyMacroBarsChart({
  days,
  calorieGoal,
  todayKey,
}: WeeklyMacroBarsChartProps) {
  const g = computeWeekBarsGeometry(days, calorieGoal);

  return (
    <View style={styles.chartWrap}>
      <svg
        viewBox={`0 0 ${g.W} ${g.H}`}
        width="100%"
        height={160}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {g.dayColumns.map((col) => {
          const isToday = col.dateKey === todayKey;
          return (
            <React.Fragment key={col.dateKey}>
              {col.segments.map((seg, idx) => (
                <rect
                  key={idx}
                  x={seg.x}
                  y={seg.y}
                  width={seg.width}
                  height={seg.height}
                  rx={seg.rx}
                  fill={seg.color}
                />
              ))}
              <text
                x={col.labelX}
                y={col.labelY}
                textAnchor="middle"
                fill={isToday ? '#0B0B0C' : '#B9B9BF'}
                fontSize={10.5}
                fontWeight={isToday ? 700 : 500}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {col.label}
              </text>
            </React.Fragment>
          );
        })}

        <line
          x1={0}
          x2={g.W}
          y1={g.goalY}
          y2={g.goalY}
          stroke="#0B0B0C"
          strokeDasharray="3 4"
          strokeOpacity={0.5}
        />
        <text
          x={g.W}
          y={g.goalY - 5}
          textAnchor="end"
          fill="#B9B9BF"
          fontSize={10.5}
          fontWeight={500}
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {`Goal ${formatNum(calorieGoal)}`}
        </text>
      </svg>
    </View>
  );
}

const styles = StyleSheet.create({
  ringCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartWrap: {
    width: '100%',
  },
});
