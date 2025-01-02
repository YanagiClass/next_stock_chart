/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  MouseEvent as ReactMouseEvent,
} from "react";
import { format } from "d3-format";
import { timeFormat } from "d3-time-format";
import {
  elderRay,
  ema,
  discontinuousTimeScaleProviderBuilder,
  Chart,
  ChartCanvas,
  CurrentCoordinate,
  BarSeries,
  CandlestickSeries,
  ElderRaySeries,
  LineSeries,
  MovingAverageTooltip,
  OHLCTooltip,
  SingleValueTooltip,
  lastVisibleItemBasedZoomAnchor,
  XAxis,
  YAxis,
  CrossHairCursor,
  EdgeIndicator,
  MouseCoordinateX,
  MouseCoordinateY,
  ZoomButtons,
} from "react-financial-charts";
import { initialData } from "./data";

/**
 * CandleChart
 * - Shift 키 누르는 동안만 오버레이 Canvas에 선 드로잉
 * - 차트 스크롤(팬) 중일 때, 기존 픽셀 좌표 선들을 함께 이동
 */
const CandleChart = () => {
  // -----------------------------
  // 1) 차트 기본 세팅
  // -----------------------------
  const ScaleProvider =
    discontinuousTimeScaleProviderBuilder().inputDateAccessor(
      (d) => new Date(d.date),
    );

  const height = 700;
  const width = 900;
  const margin = { left: 0, right: 48, top: 0, bottom: 24 };

  const ema12 = ema()
    .id(1)
    .options({ windowSize: 12 })
    .merge((d: any, c: any) => {
      d.ema12 = c;
    })
    .accessor((d: any) => d.ema12);

  const ema26 = ema()
    .id(2)
    .options({ windowSize: 26 })
    .merge((d: any, c: any) => {
      d.ema26 = c;
    })
    .accessor((d: any) => d.ema26);

  const elder = elderRay();

  // 차트용 데이터 계산
  const calculatedData = elder(ema26(ema12(initialData)));
  const { data, xScale, xAccessor, displayXAccessor } =
    ScaleProvider(calculatedData);

  const pricesDisplayFormat = format(".2f");
  const dateTimeFormat = "%d %b";
  const timeDisplayFormat = timeFormat(dateTimeFormat);

  // 보여줄 x 범위
  const max = xAccessor(data[data.length - 1]);
  const min = xAccessor(data[Math.max(0, data.length - 100)]);
  const xExtents = [min, max + 5];

  // 차트 Layout
  const gridHeight = height - margin.top - margin.bottom;
  const elderRayHeight = 100;
  const elderRayOrigin = (_: any, h: number) => [0, h - elderRayHeight];
  const barChartHeight = gridHeight / 4;
  const barChartOrigin = (_: any, h: number) => [
    0,
    h - barChartHeight - elderRayHeight,
  ];
  const chartHeight = gridHeight - elderRayHeight;

  // 각 차트의 Extents
  const barChartExtents = (d: any) => d.volume;
  const candleChartExtents = (d: any) => [d.high, d.low];
  const yEdgeIndicator = (d: any) => d.close;

  const volumeColor = (d: any) =>
    d.close > d.open ? "rgba(38, 166, 154, 0.3)" : "rgba(239, 83, 80, 0.3)";
  const volumeSeries = (d: any) => d.volume;
  const openCloseColor = (d: any) => (d.close > d.open ? "#26a69a" : "#ef5350");

  // -----------------------------
  // 2) Shift 키 상태
  // -----------------------------
  const [shiftDown, setShiftDown] = useState(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftDown(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // -----------------------------
  // 3) “차트 스크롤(팬) 중인지” 여부
  // -----------------------------
  const [isPanning, setIsPanning] = useState(false);

  // -----------------------------
  // 4) 픽셀 좌표로 저장할 선(Line)들
  // -----------------------------
  type Line = { x1: number; y1: number; x2: number; y2: number };
  const [lines, setLines] = useState<Line[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null,
  );

  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  // -----------------------------
  // 5) 선들을 그리는 함수
  // -----------------------------
  const drawAllLines = React.useCallback(
    (ctx: CanvasRenderingContext2D) => {
      lines.forEach((line) => {
        ctx.beginPath();
        ctx.moveTo(line.x1, line.y1);
        ctx.lineTo(line.x2, line.y2);
        ctx.strokeStyle = "red";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    },
    [lines],
  );

  // lines나 사이즈가 바뀔 때마다 다시 그려줌
  useEffect(() => {
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    drawAllLines(ctx);
  }, [lines, width, height, drawAllLines]);

  // -----------------------------
  // 6) 마우스 “선 드로잉” 이벤트
  // -----------------------------
  const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    // 차트가 팬 중이면, 드로잉 불가
    if (isPanning) return;
    // Shift 안누르면(차트 줌/스크롤 가능), 드로잉 안 함
    if (!shiftDown) return;
    if (lines.length >= 5) return;

    setIsDrawing(true);
    setStartPoint({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  };

  const handleMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !shiftDown) return;

    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;

    // 전체 지우고, 기존 선 다시 그림
    ctx.clearRect(0, 0, width, height);
    drawAllLines(ctx);

    // “드래그 중” 임시 선
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const handleMouseUp = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !shiftDown) return;

    setIsDrawing(false);
    const endX = e.nativeEvent.offsetX;
    const endY = e.nativeEvent.offsetY;

    setLines((prev) => [
      ...prev,
      { x1: startPoint.x, y1: startPoint.y, x2: endX, y2: endY },
    ]);
    setStartPoint(null);
  };

  // -----------------------------
  // 7) 팬(pan) 관련 메서드들
  //    → 차트가 팬 중인지 체크 + 기존 픽셀 좌표 선들을 함께 이동
  // -----------------------------
  // (이전 onPanStart →) handlePanStart
  const handlePanStart = useCallback(() => {
    setIsPanning(true);
  }, []);

  // (이전 onPan →) handlePan
  const handlePan = useCallback(
    (event: any) => {
      // event 내에는 “이전 스케일 / 현재 스케일 / dx, dy” 등이 들어있을 수 있음
      // react-financial-charts 내부적으로
      // handlePan(mousePosition, panStartXScale, { dx, dy }, chartsToPan, e)
      // 형태로 호출하므로 event.payload?.dx 를 꺼내 이동량으로 활용
      const dx = event?.payload?.dx;
      const dy = event?.payload?.dy;

      if (!dx || !lines?.length) return;

      // 기존 라인들을 모두 dx, dy만큼 이동
      setLines((prev) =>
        prev.map((line) => ({
          x1: line.x1 + dx,
          y1: line.y1 + (dy || 0),
          x2: line.x2 + dx,
          y2: line.y2 + (dy || 0),
        })),
      );
    },
    [lines],
  );

  // (이전 onPanEnd →) handlePanEnd
  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  return (
    <div style={{ position: "relative", width, height }}>
      <ChartCanvas
        height={height}
        ratio={3}
        width={width}
        margin={margin}
        data={data}
        displayXAccessor={displayXAccessor}
        seriesName="Data"
        xScale={xScale}
        xAccessor={xAccessor}
        xExtents={xExtents}
        zoomAnchor={lastVisibleItemBasedZoomAnchor}
        /*
          ChartCanvasProps에 정의된 이벤트 이름에 맞춰 변경:
          - handlePanStart={...}
          - handlePan={...}
          - handlePanEnd={...}
        */
      >
        <Chart
          id={2}
          height={barChartHeight}
          origin={barChartOrigin}
          yExtents={barChartExtents}
        >
          <BarSeries fillStyle={volumeColor} yAccessor={volumeSeries} />
        </Chart>

        <Chart id={3} height={chartHeight} yExtents={candleChartExtents}>
          <XAxis showGridLines showTickLabel={false} />
          <YAxis showGridLines tickFormat={pricesDisplayFormat} />
          <CandlestickSeries />
          <LineSeries
            yAccessor={ema26.accessor()}
            strokeStyle={ema26.stroke()}
          />
          <CurrentCoordinate
            yAccessor={ema26.accessor()}
            fillStyle={ema26.stroke()}
          />
          <LineSeries
            yAccessor={ema12.accessor()}
            strokeStyle={ema12.stroke()}
          />
          <CurrentCoordinate
            yAccessor={ema12.accessor()}
            fillStyle={ema12.stroke()}
          />
          <MouseCoordinateY
            rectWidth={margin.right}
            displayFormat={pricesDisplayFormat}
          />
          <EdgeIndicator
            itemType="last"
            rectWidth={margin.right}
            fill={openCloseColor}
            lineStroke={openCloseColor}
            displayFormat={pricesDisplayFormat}
            yAccessor={yEdgeIndicator}
          />
          <MovingAverageTooltip
            origin={[8, 24]}
            options={[
              {
                yAccessor: ema26.accessor(),
                type: "EMA",
                stroke: ema26.stroke(),
                windowSize: ema26.options().windowSize,
              },
              {
                yAccessor: ema12.accessor(),
                type: "EMA",
                stroke: ema12.stroke(),
                windowSize: ema12.options().windowSize,
              },
            ]}
          />
          <ZoomButtons />
          <OHLCTooltip origin={[8, 16]} />
        </Chart>

        <Chart
          id={4}
          height={elderRayHeight}
          yExtents={[0, elder.accessor()]}
          origin={elderRayOrigin}
          padding={{ top: 8, bottom: 8 }}
        >
          <ElderRaySeries yAccessor={elder.accessor()} />
          <XAxis showGridLines gridLinesStrokeStyle="#e0e3eb" />
          <YAxis ticks={4} tickFormat={pricesDisplayFormat} />
          <MouseCoordinateX displayFormat={timeDisplayFormat} />
          <MouseCoordinateY
            rectWidth={margin.right}
            displayFormat={pricesDisplayFormat}
          />
          <SingleValueTooltip
            yAccessor={elder.accessor()}
            yLabel="Elder Ray"
            yDisplayFormat={(d: any) =>
              `${pricesDisplayFormat(d.bullPower)}, ${pricesDisplayFormat(
                d.bearPower,
              )}`
            }
            origin={[8, 16]}
          />
        </Chart>

        <CrossHairCursor />
      </ChartCanvas>

      {/* 오버레이 Canvas (선 드로잉) */}
      <canvas
        ref={overlayRef}
        width={width}
        height={height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 9999,
          pointerEvents: shiftDown && !isPanning ? "auto" : "none",
          cursor: shiftDown && !isPanning ? "crosshair" : "default",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
    </div>
  );
};

export default CandleChart;
