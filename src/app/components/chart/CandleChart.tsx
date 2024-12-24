/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useRef, useEffect, useState, useCallback } from "react";
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

const CandleChart = () => {
  // 차트 기본 설정
  const ScaleProvider =
    discontinuousTimeScaleProviderBuilder().inputDateAccessor(
      (d) => new Date(d.date),
    );
  const height = 700;
  const width = 900;
  const margin = { left: 0, right: 48, top: 0, bottom: 24 };

  // EMA, ElderRay 지표
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

  // 데이터 계산
  const calculatedData = elder(ema26(ema12(initialData)));
  const { data, xScale, xAccessor, displayXAccessor } =
    ScaleProvider(calculatedData);

  const pricesDisplayFormat = format(".2f");
  const dateTimeFormat = "%d %b";
  const timeDisplayFormat = timeFormat(dateTimeFormat);

  // X 범위
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

  // Extents 함수들
  const barChartExtents = (d: any) => d.volume;
  const candleChartExtents = (d: any) => [d.high, d.low];
  const yEdgeIndicator = (d: any) => d.close;

  const volumeColor = (d: any) =>
    d.close > d.open ? "rgba(38, 166, 154, 0.3)" : "rgba(239, 83, 80, 0.3)";
  const volumeSeries = (d: any) => d.volume;
  const openCloseColor = (d: any) => (d.close > d.open ? "#26a69a" : "#ef5350");

  // ======================================================
  // 1) Shift 키 상태
  // ======================================================
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

  // ======================================================
  // 2) '픽셀 좌표'로 저장된 선(Line)들
  //    최대 5개까지만
  // ======================================================
  type Line = { x1: number; y1: number; x2: number; y2: number };
  const [lines, setLines] = useState<Line[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Overlay Canvas ref
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  // ======================================================
  // 3) 이미 그려진 선들을 Canvas에 그리는 함수
  // ======================================================
  const drawAllLines = useCallback(
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

  // ======================================================
  // 4) lines가 바뀔 때마다 다시 그리기
  // ======================================================
  useEffect(() => {
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    drawAllLines(ctx);
  }, [lines, width, height, drawAllLines]);

  // ======================================================
  // 5) 마우스 드로잉 이벤트 (ShiftDown일 때만 선을 그림)
  // ======================================================
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!shiftDown) return;
    if (lines.length >= 5) return;

    setIsDrawing(true);
    setStartPoint({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !shiftDown) return;

    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;

    // 기존 선들 지우고 다시 그림
    ctx.clearRect(0, 0, width, height);
    drawAllLines(ctx);

    // 드래그 중인 임시선
    ctx.beginPath();
    ctx.moveTo(startPoint.x, startPoint.y);
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.stroke();
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !shiftDown) return;
    setIsDrawing(false);

    const endX = e.nativeEvent.offsetX;
    const endY = e.nativeEvent.offsetY;

    // 새 선 추가
    setLines((prev) => [
      ...prev,
      { x1: startPoint.x, y1: startPoint.y, x2: endX, y2: endY },
    ]);
    setStartPoint(null);
  };

  // ======================================================
  // 6) "차트가 팬(스크롤)될 때" 선 좌표를 이동시키기 위한 로직
  //    - onPanStart에서 "기존 xScale" 기억
  //    - onPan에서 "이동량"만큼 line들을 평행이동
  // ======================================================
  const [lastXScale, setLastXScale] = useState<any>(null);

  // a) 팬 시작 시: 현재 xScale 저장
  const handlePanStart = useCallback(
    (event: any) => {
      // react-financial-charts가 ChartCanvas 내부 state로 xScale을 보관함
      // event에서 xScale 못 꺼내면, 아래처럼 ref를 쓰거나, event.payload.chartConfig 등에서 얻어올 수도 있습니다.
      setLastXScale(event.currentItemScale);
    },
    [setLastXScale],
  );

  // b) 팬 중: 이전 xScale vs 현재 xScale의 "0 좌표"를 비교 → dx 파악
  const handlePan = useCallback(
    (event: any) => {
      if (!lastXScale) return;

      const newXScale = event.currentItemScale;
      if (!newXScale) return;

      // 예: x=0(왼쪽) 기준점 도메인
      const domainAt0 = lastXScale.invert(0);
      // 지금 차트에서 domainAt0가 몇 픽셀 위치인지
      const oldPx = lastXScale(domainAt0);
      const newPx = newXScale(domainAt0);
      const dx = newPx - oldPx;

      // dx만큼 모든 선의 x 좌표를 옮김 (y좌표는 그대로)
      setLines((prev) =>
        prev.map((line) => ({
          x1: line.x1 + dx,
          y1: line.y1,
          x2: line.x2 + dx,
          y2: line.y2,
        })),
      );
    },
    [lastXScale, setLines],
  );

  // c) 팬 종료 시: lastXScale 초기화 (또는 더 정교하게 해도 됨)
  const handlePanEnd = useCallback(() => {
    setLastXScale(null);
  }, []);

  // ======================================================
  // 7) Chart 렌더
  //    - onPanStart, onPan, onPanEnd 콜백을 등록
  // ======================================================
  return (
    <div style={{ position: "relative", width, height, zIndex: 1 }}>
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
        // 팬 이벤트 등록
        onPanStart={handlePanStart}
        onPan={handlePan}
        onPanEnd={handlePanEnd}
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

      {/* 오버레이 Canvas */}
      <canvas
        ref={overlayRef}
        width={width}
        height={height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 9999,
          pointerEvents: shiftDown ? "auto" : "none",
          cursor: shiftDown ? "crosshair" : "default",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
    </div>
  );
};

export default CandleChart;
