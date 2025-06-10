import React, { useState, useEffect, useCallback } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  ResponsiveContainer, ReferenceArea, Scatter 
} from 'recharts';


// 선택 가능한 날짜 배열 (지정된 날짜만 포함)
const availableDates = [
  { date: "2020-03-12", label: "2020-03-12" },
  { date: "2020-03-13", label: "2020-03-13 (서킷브레이커)", hasCircuitBreaker: true },
  { date: "2020-03-19", label: "2020-03-19 (서킷브레이커)", hasCircuitBreaker: true },
  { date: "2020-03-23", label: "2020-03-23" },
  { date: "2024-08-05", label: "2024-08-05 (서킷브레이커)", hasCircuitBreaker: true },
  { date: "2025-04-07", label: "2025-04-07" }
];

// 30분 간격으로 고정된 시간 슬롯 정의
const fixedTimeSlots = [ 
  "09:30", "10:00", "10:30", "11:00", "11:30", 
  "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", 
  "15:00", "15:20"
];

// 시간을 오전/오후 형식으로 변환하는 함수
const formatTimeToAmPm = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours < 12 ? '오전' : '오후';
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${period} ${displayHours}:${minutes.toString().padStart(2, '0')}`;
};

// 시간 차이 계산 함수 (format: "HH:MM" -> "+HH:MM" 또는 "-HH:MM" 형식)
const calculateTimeDifference = (startTime, endTime) => {
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  
  // 시작 시간과 종료 시간을 분 단위로 변환
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + endMinute;

  // 시간 차이 계산 (분 단위)
  let diffMinutes = endTotalMinutes - startTotalMinutes;
  
  // 부호 결정
  const sign = diffMinutes >= 0 ? "+" : "-";
  
  // 절대값으로 변환
  diffMinutes = Math.abs(diffMinutes);
  
  // 시, 분으로 변환
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  
  // "+HH:MM" 또는 "-HH:MM" 형식으로 반환
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

function Dashboard() {
  const defaultDate = availableDates.find(d => d.isDefault) || availableDates[0];
  
  const [thresholdValue, setThresholdValue] = useState(0.05); // 동조화 수치 임계값 고정정
  const [thresholdReturn, setThresholdReturn] = useState(-0.04); // 수익률 임계값
  const [selectedDate, setSelectedDate] = useState(defaultDate.date); // 기본 날짜로 초기화
  
    // 데이터 상태 관리 추가
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [circuitBreakerConfig, setCircuitBreakerConfig] = useState([]);

// 유틸리티 함수들을 useCallback으로 감싸기
const getCircuitBreakerForDate = useCallback((date) => {
  const info = circuitBreakerConfig.find(cb => cb.date === date);
  console.log('getCircuitBreakerForDate:', { date, info, allConfig: circuitBreakerConfig });
  return info || null;
}, [circuitBreakerConfig]);

const isTimeInCircuitBreakerPeriod = useCallback((time, date) => {
  const cbInfo = getCircuitBreakerForDate(date);
  if (!cbInfo) return false;
  return time >= cbInfo.time_start && time <= cbInfo.time_end;
}, [getCircuitBreakerForDate]);

// 선택된 날짜에 서킷브레이커 여부 확인
const hasCircuitBreaker = getCircuitBreakerForDate(selectedDate) !== null;

// 서킷브레이커 설정 로드 함수 추가 
const loadCircuitBreakerConfig = useCallback(async () => {
  try {
    const response = await fetch('https://mocki.io/v1/93e858e1-617d-4885-a6a7-23659e1cafd7');
    if (!response.ok) {
      throw new Error('서킷브레이커 설정 파일을 불러올 수 없습니다.');
    }
    
    const config = await response.json();
    console.log('서킷브레이커 설정 로드:', config);
    setCircuitBreakerConfig(config);
  } catch (error) {
    console.error('서킷브레이커 설정 로드 실패:', error);
    setCircuitBreakerConfig([]);
  }
}, []);

// 데이터 로드 함수
const loadData = useCallback(async () => {
  try {
    setLoading(true);
    
    // API에서 동조화 값 (date, time, value) 로드
    const syncResponse = await fetch('https://mocki.io/v1/ab9ee5cc-a0c9-4bab-b1a8-d671d61cf853');
    const syncApiData = await syncResponse.json();
    
    // 파일 2: 코스피 지수 (date, time, return) 로드
    const kospiResponse = await fetch('https://mocki.io/v1/c0753d0b-ed35-497a-a69f-ff0009430bab');
    const kospiApiData = await kospiResponse.json();
    
    // 현재 선택된 날짜에 해당하는 데이터만 필터링
    const syncData = syncApiData.filter(item => item.date === selectedDate);
    const kospiData = kospiApiData.filter(item => item.date === selectedDate);

    // 현재 날짜의 서킷브레이커 정보
    const circuitBreakerInfo = getCircuitBreakerForDate(selectedDate);

    // 데이터 병합 (날짜와 시간 기준)
    const mergedData = syncData.map(syncItem => {
      // 같은 time 값을 가진 kospiData의 항목 찾기
      const kospiItem = kospiData.find(k => k.time === syncItem.time);
      
      // 기본 항목 생성
      const item = {
        time: syncItem.time,
        value: syncItem.value,
        return: kospiItem ? kospiItem.return : 0
      };
      
      // 서킷브레이커 구간 체크 (동적 시간)
      if (isTimeInCircuitBreakerPeriod(syncItem.time, selectedDate)) {
        item.event = 'circuit_break';
        item.circuitBreakerInfo = {
          start: circuitBreakerInfo.time_start,
          end: circuitBreakerInfo.time_end,
          isStart: syncItem.time === circuitBreakerInfo.time_start,
          isEnd: syncItem.time === circuitBreakerInfo.time_end
        };
      }
      
      return item;
    });
      
    setData(mergedData);
    setLoading(false);
  } catch (err) {
    console.error('데이터 로드 오류:', err);
    setError('데이터를 로드하는 중 오류가 발생했습니다.');
    setLoading(false);
  }
}, [selectedDate, getCircuitBreakerForDate, isTimeInCircuitBreakerPeriod]);

// 서킷브레이커 설정 로드
useEffect(() => {
  loadCircuitBreakerConfig();
}, [loadCircuitBreakerConfig]);

// 선택된 날짜가 변경될 때마다 데이터 다시 로드
useEffect(() => {
  if (selectedDate && circuitBreakerConfig.length >= 0) {
    loadData();
  }
}, [selectedDate, circuitBreakerConfig, loadData]);
  
  
// 경고 이벤트 계산 및 알림 생성을 위한 데이터 처리
const processedData = data.map((item) => {
  let event = null;
  
  // 서킷브레이커 구간에 있는 경우
  if (isTimeInCircuitBreakerPeriod(item.time, selectedDate)) {
    event = "circuit_break";
  } 
  // 임계값을 만족하는 경우 warning
  else if (item.value < thresholdValue && item.return < thresholdReturn) {
    event = "warning";
  }
  
  return { ...item, event };
});

  
    // Y축 범위 동적 계산
  const calculateYAxisDomain = (data, dataKey, padding = 0.1) => {
    const values = data.map(item => item[dataKey]).filter(val => val !== null && val !== undefined);
    if (values.length === 0) return [0, 1];
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const paddingValue = range * padding;
    
    return [min - paddingValue, max + paddingValue];
  };

  // 동적 Y축 범위 계산
  const leftAxisDomain = calculateYAxisDomain(processedData, 'value', 0.1);
  const rightAxisDomain = calculateYAxisDomain(processedData, 'return', 0.1);
  
  // 경고 신호가 발생한 데이터 포인트 필터링
  const warningPoints = processedData.filter(item => 
    item.event === "warning"
  );
  
  // 서킷브레이커 시간 찾기
  const currentCircuitBreakerInfo = getCircuitBreakerForDate(selectedDate);
  const circuitBreakerTime = currentCircuitBreakerInfo ? currentCircuitBreakerInfo.time_start : null;

  
  // 알림 내역 생성
  // 경고 신호 발생 시간을 기준으로 최신순으로 정렬
  const alerts = warningPoints.map(point => {
    // 서킷브레이커까지 남은 시간 계산
    let timeToCircuitBreaker = "N/A";
    if (circuitBreakerTime) {
      // 항상 시간 차이를 계산하고, 양수/음수로 표현
      timeToCircuitBreaker = calculateTimeDifference(point.time, circuitBreakerTime);
    }
    
    return {
      time: point.time,
      value: point.value,
      return: point.return,
      timeToCircuitBreaker
    };
  })
  // 시간 내림차순 정렬 (최초 발생순)
  .sort((a, b) => {
      const [aHour, aMinute] = a.time.split(":").map(Number);
      const [bHour, bMinute] = b.time.split(":").map(Number);
      
      const aTotalMinutes = aHour * 60 + aMinute;
      const bTotalMinutes = bHour * 60 + bMinute;
      
      return aTotalMinutes - bTotalMinutes; // 오름차순
    });


  return (
    <div style={{ 
      minWidth: '100vw', 
      minHeight: '100vh', 
      padding: '80px',
      backgroundColor: '#f9fafb',
      fontFamily: 'Roboto',
      boxSizing: 'border-box'
    }}>
      {/* 헤더 */}
      <h1 style={{ 
        fontSize: '2rem', 
        fontWeight: 'bold', 
        color: '#1f2937',
        fontFamily: 'BlinkMacSystemFont',
        marginBottom: '24px'
      }}>
        Market Early Warning System🔥
      </h1>
      <div style={{ 
        backgroundColor: 'white', 
        padding: '24px',
        marginBottom: '20px',
        borderRadius: '3px',
        border: '1px solid #e5e7eb'
      }}>
        {/* 헤더 부분 */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(4, 1fr)', 
          gap: '50px' 
        }}>
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '4px', 
              fontSize: '0.875rem', 
              fontWeight: '500', 
              color: '#374151' 
            }}>
              날짜 선택
            </label>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <select 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{ 
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px'
                }}
              >
                {availableDates.map((dateOption) => (
                  <option key={dateOption.date} value={dateOption.date}>
                    {dateOption.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '4px', 
              fontSize: '0.875rem', 
              fontWeight: '500', 
              color: '#374151' 
            }}>
              동조화 임계값
            </label>
            <div>
              <input 
                type="number" 
                step="0.01"
                value={thresholdValue}
                onChange={(e) => setThresholdValue(parseFloat(e.target.value))}
                style={{ 
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px'
                }}
              />
            </div>
          </div>
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '4px', 
              fontSize: '0.875rem', 
              fontWeight: '500', 
              color: '#374151' 
            }}>
              수익률 임계값(%)
            </label>
            <div>
              <input 
                type="number" 
                step="0.01"
                value={thresholdReturn}
                onChange={(e) => setThresholdReturn(parseFloat(e.target.value))}
                style={{ 
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px'
                }}
              />
            </div>
          </div>
          <div>
            <label style={{ 
              display: 'block', 
              marginBottom: '4px', 
              fontSize: '0.875rem', 
              fontWeight: '500', 
              color: '#374151' 
            }}>
              분석 대상
            </label>
            <div>
              <select style={{ 
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '4px'
              }}>
                <option value="kospi_top40">KOSPI 거래량 상위 40개</option>
              </select>
            </div>
          </div>
        </div>
        
        {/* 초기화 버튼 */}
        <div style={{ 
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: '24px'
        }}>
          <button style={{ 
            color: '#666666',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            background: 'none',
            border: 'none',
            borderRadius: '6px',
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            transition: 'all 0.2s ease'
          }} 
          onClick={() => window.location.reload()}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f3f4f6';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}>
            <span>초기화</span>
          </button>
        </div>
      </div>
      
      {/* 로딩 표시 */}
      {loading && (
        <div style={{ 
          textAlign: 'center', 
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          데이터를 불러오는 중입니다...
        </div>
      )}
      
      {/* 에러 표시 */}
      {error && (
        <div style={{ 
          textAlign: 'center', 
          padding: '20px',
          backgroundColor: 'white',
          borderRadius: '8px',
          marginBottom: '20px',
          color: '#ef4444'
        }}>
          {error}
        </div>
      )}
      
{!loading && !error && (
  <div style={{ 
    backgroundColor: 'white', 
    padding: '20px', 
    borderRadius: '3px',
    border: '1px solid #e5e7eb',
    marginBottom: '20px'
  }}>
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <h2 style={{ 
        fontSize: '1.2rem', 
        fontWeight: '500',
        color: '#text-gray-700',
        marginRight: '20px'
      }}>
        Monitoring Dashboard
      </h2>
      
      {/* 신호 발생 조건 - 인라인 배치 */}
      <div style={{ 
        backgroundColor: '#f8fafc', 
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #999999',
        borderRadius: '3px',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        <span style={{ 
          fontSize: '16px', 
          marginRight: '8px' 
        }}>⚠️</span>
        
        <span style={{ 
          fontSize: '0.85rem', 
          fontWeight: '600',
          color: '#334155',
          marginRight: '8px'
        }}>신호 발생 조건:</span>
        
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          fontSize: '0.85rem', 
          color: '#475569',
          gap: '4px'
        }}>
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <div style={{ 
              width: '4px', 
              height: '4px', 
              backgroundColor: 'var(--chart-1)', 
              borderRadius: '50%'
            }}></div>
            <span>Distance matrix &lt; <strong style={{ color: '#1e293b' }}>{thresholdValue}</strong></span>
          </div>
          
          <span style={{ margin: '0 6px', color: '#94a3b8' }}>+</span>
          
          <div style={{ 
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <div style={{ 
              width: '4px', 
              height: '4px', 
              backgroundColor: 'var(--chart-2)', 
              borderRadius: '50%'
            }}></div>
            <span>KOSPI Index return &lt; <strong style={{ color: '#1e293b' }}>{thresholdReturn}</strong></span>
          </div>
        </div>
      </div>
    </div>
    
    <div style={{ marginTop: '20px', height: '400px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart 
          data={processedData}
          margin={{
            top: 40,  // 상단 여백 늘림
            right: 30,
            left: 20,
            bottom: 5
          }}
        >
          
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="time"
            type="category"
            domain={fixedTimeSlots}
            ticks={fixedTimeSlots}
            interval={0}
            scale="point"
            padding={{ left: 20, right: 20 }}
          /> 
          <YAxis 
            yAxisId="left" 
            domain={leftAxisDomain} 
            tickFormatter={(value) => value.toFixed(2)}
            label={{ 
              value: 'Distance matrix', 
              angle: -90, 
              position: 'insideLeft',
              style: { textAnchor: 'middle', fill: 'var(--chart-1)' }
            }}
          />
          <YAxis 
            yAxisId="right" 
            orientation="right" 
            domain={rightAxisDomain} 
            tickFormatter={(value) => value.toFixed(2)}
            label={{ 
              value: 'KOSPI Index return (%)', 
              angle: 90, 
              position: 'insideRight',
              style: { textAnchor: 'middle', fill: 'var(--chart-2)' }
            }}
          />
          
          {/* 그라데이션 정의 */}
          <defs>
            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorReturn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0}/>
            </linearGradient>
          </defs>

          {/* 경고 포인트 표시 */}
          <Scatter
            data={warningPoints}
            fill="#fbbf24"
            stroke="#f59e0b"
            strokeWidth={1}
            yAxisId="left"
            dataKey="value"
            shape={(props) => {
              const { cx, cy } = props;
              return (
                <text 
                  x={cx} 
                  y={cy+2} 
                  textAnchor="middle" 
                  fontSize="18"
                >
                  ⚠️
                </text>
              );
            }}
          />

          {/* 서킷브레이커 구간 표시 */}
{(() => {
  console.log('차트 렌더링 시점:', { 
    hasCircuitBreaker, 
    selectedDate, 
    circuitBreakerConfig,
    processedData 
  });
  
  if (!hasCircuitBreaker) return null;
  
  const cbInfo = getCircuitBreakerForDate(selectedDate);
  if (!cbInfo) {
    console.log('서킷브레이커 정보 없음');
    return null;
  }

  console.log('서킷브레이커 표시 정보:', {
    original: cbInfo,
    display: { start: cbInfo.time_start, end: cbInfo.time_end }
  });

  return (
    <ReferenceArea
      key="circuit-breaker-start"
      x1={cbInfo.time_start}
      x2={cbInfo.time_end}
      yAxisId="left"
      fill="#dcfce7"
      fillOpacity={0.3}
      stroke="#22c55e"
      strokeOpacity={0.5}
      strokeDasharray="3 3"
      label={{
        value: `✅ 서킷브레이커 발동 (${cbInfo.time_start} ~ ${cbInfo.time_end})`,
        position: "insideTopLeft",
        fill: "#22c55e",
        fontSize: 12
      }}
    />
  );
})()}
          
           {/* 범례 - 3. KOSPI Index return */}
          <Line 
            yAxisId="right"
            dot={false}
            type="monotone" 
            dataKey="return" 
            stroke="var(--chart-2)" 
            strokeWidth={2}
            activeDot={{ r: 4, fill: "var(--chart-2)", stroke: "#ffffff", strokeWidth: 2 }}
            name="KOSPI Index return"
            connectNulls={true}
            fill="url(#colorReturn)"
          />
          
          {/* 범례 - 4. KOSPI Index return 임계값*/}
          <Line 
            yAxisId="right"
            type="monotone" 
            dataKey={() => thresholdReturn} 
            stroke="var(--chart-2)" 
            strokeDasharray="2 1"
            activeDot={false}
            dot={false}
          />
          
          {/* 범례 - 1. 동조화 수치 */}
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="value" 
            stroke="var(--chart-1)" 
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props;
              
              // 서킷브레이커 구간에 있으면 아이콘 표시하지 않음
              if (payload.event === "circuit_break") {
                return null;
              }
              
              // 경고 조건을 만족하는 경우에만 아이콘 표시
              const isWarning = payload.value < thresholdValue && payload.return < thresholdReturn;
              
              if (isWarning) {
                return (
                  <text 
                    x={cx} 
                    y={cy+2} 
                    textAnchor="middle" 
                    fontSize="18"
                  >
                    ⚠️
                  </text>
                );
              }
              return null;
            }}
            activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "#ffffff", strokeWidth: 2 }}
            name="Distance matrix"
            connectNulls={true}
            fill="url(#colorValue)"
          />
        
          {/* 범례 - 2. 동조화 임계값 */}
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey={() => thresholdValue} 
            stroke="var(--chart-1)" 
            strokeDasharray="2 1"
            activeDot={false}
            dot={false} 
          />
          
          <Tooltip 
            formatter={(value, name) => {
              if (name === "Distance matrix") return [value, name];
              if (name === "KOSPI Index return") return [`${(value).toFixed(2)}%`, name];
              return null;
            }}
            contentStyle={(props) => {
              // props.payload[0]가 있고, 해당 데이터 포인트가 경고 조건을 만족하는 경우
              const isWarning = props.payload?.[0]?.payload &&
                props.payload[0].payload.value < thresholdValue && 
                props.payload[0].payload.return < thresholdReturn;

              return {
                backgroundColor: isWarning ? '#fefce8' : '#ffffff',
                border: isWarning ? '1px solid #fef08a' : '1px solid #d1d5db',
                borderRadius: '4px',
                padding: '8px'
              };
            }}
            labelStyle={(props) => {
              const isWarning = props.payload?.[0]?.payload &&
                props.payload[0].payload.value < thresholdValue && 
                props.payload[0].payload.return < thresholdReturn;

              return {
                color: isWarning ? '#854d0e' : '#374151',
                fontWeight: 'bold',
                marginBottom: '4px'
              };
            }}
            itemStyle={(props) => {
              const isWarning = props.payload?.[0]?.payload &&
                props.payload[0].payload.value < thresholdValue && 
                props.payload[0].payload.return < thresholdReturn;

              return {
                color: isWarning ? '#854d0e' : '#374151'
              };
            }}
          />
          <Legend />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
)}
      
      {/* 알림 패널 - 로딩 중이 아닐 때만 표시 */}
      {!loading && !error && (
        <div style={{ 
          backgroundColor: 'white', 
          padding: '20px', 
          borderRadius: '3px',
          border: '1px solid #e5e7eb'
        }}>
          <h2 style={{ 
            fontSize: '1.2rem', 
            fontWeight: '500',
            color: '#text-gray-700',
            marginBottom: '16px',
            textAlign: 'left',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>Alert Log</span>
            <span style={{
              fontSize: '0.875rem',
              color: '#6b7280',
              fontWeight: '400'
            }}>
              총 {alerts.length}건 신호 발생
            </span>
          </h2>
          
          {/* 알림 항목들 - 동적으로 생성 */}
          <div style={{
            maxHeight: '352px', // 알림 항목 높이(44px) * 8개 = 352px
            overflowY: 'auto',
            marginRight: '-8px',
            paddingRight: '8px'
          }}>
            {alerts.length > 0 ? (
              alerts.map((alert, index) => (
                <div 
                  key={`alert-${index}`}
                  style={{ 
                    borderLeft: index === 0 ? '3px solid #dc2626' : '3px solid #ef4444',
                    border: index === 0 ? '1px solid #fee2e2' : 'none',
                    padding: '10px 14px',
                    marginBottom: '6px',
                    backgroundColor: index === 0 ? '#fef2f2' : '#fafafa',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#fef2f2';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = index === 0 ? '#fef2f2' : '#fafafa';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                      <span style={{ fontSize: '16px' }}>
                        {index === 0 ? '🚨' : '⚠️'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                        <span style={{ fontWeight: '600', color: '#374151' }}>
                          {index === 0 && (
                            <span style={{ 
                              color: '#dc2626', 
                              backgroundColor: '#fee2e2',
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              marginRight: '6px',
                              fontWeight: '600'
                            }}>
                              최초
                            </span>
                          )}
                          동조화신호 발생
                        </span>
                        <span style={{ color: '#6b7280' }}>
                          ({formatTimeToAmPm(alert.time)})
                        </span>
                        {hasCircuitBreaker && (
                          <span style={{ 
                            color: alert.timeToCircuitBreaker.startsWith('+') ? '#1e40af' : '#b91c1c',
                            backgroundColor: alert.timeToCircuitBreaker.startsWith('+') ? '#dbeafe' : '#fef2f2',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: '500',
                            marginLeft: '6px'
                          }}>
                            [서킷브레이커{alert.timeToCircuitBreaker.startsWith('+') ? ' 발생 전 -' : ' 발생 후 +'} {alert.timeToCircuitBreaker.replace(/^[+-]/,'')}]
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem', color: '#6b7280' }}>
                      <span>동조화: {alert.value.toFixed(2)}</span>
                      <span>수익률: {alert.return.toFixed(2)}%</span>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        color: '#9ca3af',
                        cursor: 'pointer'
                      }}></span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ 
                padding: '16px', 
                backgroundColor: '#f9fafb', 
                borderRadius: '6px',
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '0.9rem'
              }}>
                현재 임계값 기준으로 발생한 알림이 없습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Copyright */}
      <div style={{
        textAlign: 'center',
        color: '#6b7280',
        fontSize: '0.75rem',
        marginTop: '40px',
        marginBottom: '20px'
      }}>
        Copyright © 2025 Fount Investment Co., Ltd. All rights reserved.
      </div>
    </div>
  );
}

export default Dashboard;