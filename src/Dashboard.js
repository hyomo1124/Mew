import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  ResponsiveContainer, ReferenceLine, ReferenceArea, Scatter 
} from 'recharts';
import Papa from 'papaparse';

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

// 시간을 30분 단위로 그룹핑하는 함수
const groupToTimeSlot = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;
  if (hours === 15 && minutes >= 1) {
    return "15:20";
  }
  const slotMinutes = Math.floor(totalMinutes / 30) * 30;
  const slotHours = Math.floor(slotMinutes / 60);
  const slotMins = slotMinutes % 60;
  return `${slotHours.toString().padStart(2, '0')}:${slotMins.toString().padStart(2, '0')}`;
};

// 데이터를 30분 단위로 집계하는 함수
const aggregateDataToFixedSlots = (rawData) => {
  const groupedData = {};
  fixedTimeSlots.forEach(slot => {
    groupedData[slot] = { time: slot, values: [], returns: [] };
  });
  
  rawData.forEach(item => {
    const slot = groupToTimeSlot(item.time);
    if (groupedData[slot]) {
      if (item.value !== null && item.value !== undefined) {
        groupedData[slot].values.push(item.value);
      }
      if (item.return !== null && item.return !== undefined) {
        groupedData[slot].returns.push(item.return);
      }
    }
  });
  
  return fixedTimeSlots.map(slot => {
    const group = groupedData[slot];
    return {
      time: slot,
      value: group.values.length > 0 ? group.values[group.values.length - 1] : null,
      return: group.returns.length > 0 ? group.returns[group.returns.length - 1] : null,
    };
  });
};

// 경고 구간 찾기 함수 (동조화 수치와 수익률이 모두 임계값 미만인 포인트 기준으로 확장)
const findWarningRanges = (data, valueThreshold, returnThreshold) => {
  const ranges = [];
  const warningPoints = data
    .map((item, index) => ({ ...item, index }))
    .filter(item => item.value < valueThreshold && item.return < returnThreshold);
  
  if (warningPoints.length === 0) {
    return [];
  }
  
  // 각 경고 포인트에 대해 확장된 구간 생성 (앞뒤 구간 포함)
  warningPoints.forEach(point => {
    const pointIndex = point.index;
    
    // 경고 포인트 앞의 데이터 포인트 인덱스 (최소 0)
    const startIndex = Math.max(0, pointIndex );
    // 경고 포인트 뒤의 데이터 포인트 인덱스 (최대 data.length - 1)
    const endIndex = Math.min(data.length - 1, pointIndex + 1);
    
    ranges.push({
      start: data[startIndex].time,
      end: data[endIndex].time
    });
  });
  
  return ranges;
};

// 시간 차이 계산 함수 (format: "HH:MM" -> "+HH:MM:SS" 또는 "-HH:MM:SS" 형식)
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
  
  // "+HH:MM:00" 또는 "-HH:MM:00" 형식으로 반환
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
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
    const [dismissedAlerts, setDismissedAlerts] = useState({}); // 날짜별로 삭제된 알림 추

  // 유틸리티 함수들 추가 (loadData 함수 앞에 추가)
const getCircuitBreakerForDate = (date) => {
  return circuitBreakerConfig.find(cb => cb.date === date) || null;
};

const isTimeInCircuitBreakerPeriod = (time, date) => {
  const cbInfo = getCircuitBreakerForDate(date);
  if (!cbInfo) return false;
  return time >= cbInfo.time_start && time <= cbInfo.time_end;
};

  // 선택된 날짜 객체 가져오기
  const selectedDateInfo = availableDates.find(d => d.date === selectedDate) || defaultDate;

  // 선택된 날짜에 서킷브레이커 여부 확인
  const hasCircuitBreaker = getCircuitBreakerForDate(selectedDate) !== null;

  
  // 서킷브레이커 설정 로드 함수 추가 
const loadCircuitBreakerConfig = async () => {
  try {
    const response = await fetch('https://mocki.io/v1/93e858e1-617d-4885-a6a7-23659e1cafd7');
    if (!response.ok) {
      throw new Error('서킷브레이커 설정 파일을 불러올 수 없습니다.');
    }
    
    const config = await response.json();
    setCircuitBreakerConfig(config);
    
    console.log('서킷브레이커 설정 로드 완료:', config);
  } catch (error) {
    console.error('서킷브레이커 설정 로드 실패:', error);
    setCircuitBreakerConfig([]);
  }
};

  // 데이터 로드 함수
  const loadData = async () => {
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
};

  // 서킷브레이커 설정 로드
  useEffect(() => {
  loadCircuitBreakerConfig();
  }, []);

  // 선택된 날짜가 변경될 때마다 데이터 다시 로드
  useEffect(() => {
    if (selectedDate && circuitBreakerConfig.length >= 0) {
      loadData();
      // 날짜가 변경되면 해당 날짜의 삭제된 알림 목록 초기화
      setDismissedAlerts(prev => ({
        ...prev,
        [selectedDate]: prev[selectedDate] || []
      }));
    }
  }, [selectedDate, circuitBreakerConfig]);
  
  
  // 경고 이벤트 계산 및 알림 생성을 위한 데이터 처리
  const processedData = data.map((item) => {
    if (item.event === "circuit_break") {
      return item;
    }
    let event = null;
    if (item.value < thresholdValue && item.return < thresholdReturn) {
      event = "warning";
    }
    return { ...item, event };
  });

  
    // 경고 구간 계산 (동적)
  const warningRanges = findWarningRanges(processedData, thresholdValue, thresholdReturn);

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
  
  // 경고 신호가 발생한 데이터 포인트 필터링 (실제로 두 조건을 모두 만족하는 포인트만)
  const warningPoints = processedData.filter(item => 
    item.event === 'warning'
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
  // 삭제된 알림 필터링
  .filter(alert => {
    const dismissedForDate = dismissedAlerts[selectedDate] || [];
    return !dismissedForDate.includes(alert.time);
  })
  // 시간 내림차순 정렬 (최신순)
  .sort((a, b) => {
    const [aHour, aMinute] = a.time.split(":").map(Number);
    const [bHour, bMinute] = b.time.split(":").map(Number);
    
    const aTotalMinutes = aHour * 60 + aMinute;
    const bTotalMinutes = bHour * 60 + bMinute;
    
    return bTotalMinutes - aTotalMinutes; // 내림차순
  });
  
  return (
    <div style={{ 
      minWidth: '100vw', 
      minHeight: '100vh', 
      padding: '120px',
      backgroundColor: '#f9fafb',
      fontFamily: 'Arial, sans-serif',
      boxSizing: 'border-box'
    }}>
      {/* 헤더 */}
      <div style={{ 
        backgroundColor: 'white', 
        padding: '16px 24px',
        marginBottom: '20px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1f2937' }}>
          Market Early Warning System⚠️ 
        </h1>
        <div style={{ display: 'flex', gap: '16px' }}>
          <button style={{ 
            color: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer'
          }} onClick={() => window.location.reload()}>
            <span>초기화</span>
          </button>
        </div>
      </div>
      
      {/* 필터 패널 */}
      <div style={{ 
        backgroundColor: 'white', 
        padding: '16px',
        marginBottom: '20px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
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
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    marginBottom: '20px'
  }}>
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '15px' 
    }}>
      <h2 style={{ 
        fontSize: '1.25rem', 
        fontWeight: 'bold',
        marginRight: '15px'
      }}>
        Monitoring Dashboard - {selectedDateInfo.label}
      </h2>
      
      {/* 신호 발생 조건 */}
      <div style={{ 
        backgroundColor: '#f8fafc', 
        border: '1px solid #e2e8f0',
        borderLeft: '4px solid #ef4444',
        borderRadius: '6px',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
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
          marginRight: '12px',
          whiteSpace: 'nowrap'
        }}>신호 발생 조건:</span>
        
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          fontSize: '0.85rem', 
          color: '#475569',
          whiteSpace: 'nowrap'
        }}>
          <div style={{ 
            width: '10px', 
            height: '10px', 
            backgroundColor: '#ef4444', 
            borderRadius: '50%', 
            marginRight: '6px' 
          }}></div>
          <span>Distance matrix &lt; <strong style={{ color: '#1e293b' }}>{thresholdValue}</strong></span>
          
          <span style={{ margin: '0 10px' }}>+</span>
          
          <div style={{ 
            width: '10px', 
            height: '10px', 
            backgroundColor: '#3b82f6', 
            borderRadius: '50%', 
            marginRight: '6px' 
          }}></div>
          <span>KOSPI Index return &lt; <strong style={{ color: '#1e293b' }}>{thresholdReturn}</strong></span>
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
          <YAxis yAxisId="left" domain={leftAxisDomain} tickFormatter={(value) => value.toFixed(2)} />
          <YAxis yAxisId="right" orientation="right" domain={rightAxisDomain} tickFormatter={(value) => value.toFixed(2)} />
          
          {/* 동적으로 계산된 경고 구간 */}
          {warningRanges.map((range, index) => (
            <ReferenceArea 
              key={`warning-${index}`}
              x1={range.start} 
              x2={range.end} 
              yAxisId="left"
              fill="#fff8e1" 
              fillOpacity={0.4} 
              stroke="#ffc107"
              strokeOpacity={0.6}
              strokeDasharray="3 3"
              label={index === 0 ? { 
                value: "경고 구간", 
                position: "insideTopRight",
                fill: "#f57c00",
                fontSize: 12
              } : null}
            />
          ))}

          {/* 동적으로 계산된 경고 지점에 이모지 표시 */}
          <Scatter
            data={processedData.filter(item => item.value < thresholdValue && item.return < thresholdReturn)}
            fill="transparent"
            yAxisId="left"
            dataKey="value"
            shape={(props) => {
              const { cx, cy } = props;
              return (
                <text 
                  x={cx} 
                  y={cy - 15} 
                  textAnchor="middle" 
                  fontSize="18"
                >
                  ⚠️
                </text>
              );
            }}
          />

          {/* 서킷브레이커 지점에 이모지 표시 - 선택된 날짜에 서킷브레이커가 있을 경우에만 표시 */}
          {hasCircuitBreaker && (() => {
            const cbInfo = getCircuitBreakerForDate(selectedDate);
            if (!cbInfo) return null;
            return (
              <ReferenceArea
              key="circuit-breaker-line"
              x={cbInfo.time_start}
              stroke="#22c55e"
              strokeWidth={3}
              strokeDasharray="5 5"
                label={{
                  value: `✅ 서킷브레이커 (${cbInfo.time_start})`,
                  position: "insideTopLeft",
                  fill: "#22c55e",
                  fontSize: 12
                }}
              />
            );
          })()}
          
           {/* 범례 - 1. 동조화 수치 */}
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="value" 
            stroke="#ef4444" 
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 6, fill: "#ef4444", stroke: "#ffffff", strokeWidth: 2 }}
            name="Distance matrix"
            connectNulls={true}
          />
        
          {/* 범례 - 2. 동조화 임계값 */}
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey={() => thresholdValue} 
            stroke="#ef4444" 
            strokeDasharray="2 1"
            activeDot={false}
            dot={false} 
          />

          {/* 범례 - 3. KOSPI Index return */}
          <Line 
            yAxisId="right"
            dot={false}
            type="monotone" 
            dataKey="return" 
            stroke="#3b82f6" 
            strokeWidth={2}
            activeDot={{ r: 6, fill: "#3b82f6", stroke: "#ffffff", strokeWidth: 2 }}
            name="KOSPI Index return"
            connectNulls={true}
          />
          
          {/* 범례 - 4. KOSPI Index return 임계값값*/}
          <Line 
            yAxisId="right"
            type="monotone" 
            dataKey={() => thresholdReturn} 
            stroke="#3b82f6" 
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
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ 
            fontSize: '1.25rem', 
            fontWeight: 'bold',
            marginBottom: '16px' ,
            textAlign: 'left'
          }}>알림 내역 - {selectedDateInfo.label}</h2>
          
          {/* 알림 항목들 - 동적으로 생성 */}
          <div>
            {alerts.length > 0 ? (
              alerts.map((alert, index) => (
                <div 
                  key={`alert-${index}`}
                  style={{ 
                    borderLeft: '4px solid #ef4444',
                    padding: '16px',
                    marginBottom: '8px',
                    backgroundColor: '#fafafa',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 0.3s ease'
                  }}
                  onClick={() => {
                    setDismissedAlerts(prev => ({
                      ...prev,
                      [selectedDate]: [...(prev[selectedDate] || []), alert.time]
                    }));
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#fafafa';
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ color: '#ef4444', marginRight: '8px' }}>⚠️</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ fontWeight: 'bold' }}>동조화 신호 발생</p>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        color: '#9ca3af',
                        fontStyle: 'italic'
                      }}>X</span>
                    </div>
                      <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'left', gap: '4px' }}>
                          <span>🕒</span>
                          <span>{`${selectedDate} ${alert.time}`}</span>
                        </div>
                        <div style={{ marginTop: '4px', textAlign: 'left' }}>
                          <span style={{ fontWeight: '500' }}>동조화 수치:</span> {alert.value.toFixed(2)} (임계치: {thresholdValue})
                        </div>
                        <div style={{ marginTop: '4px', textAlign: 'left' }}>
                          <span style={{ fontWeight: '500' }}>수익률:</span> {alert.return.toFixed(2)}% (임계치: {thresholdReturn.toFixed(2)}%)
                        </div>
                        {hasCircuitBreaker && (
                          <div style={{ 
                            marginTop: '4px', 
                            display: 'flex', 
                            alignItems: 'center',
                            backgroundColor: alert.timeToCircuitBreaker.startsWith('+') ? '#dbeafe' : '#fef2f2',
                            color: alert.timeToCircuitBreaker.startsWith('+') ? '#1e40af' : '#b91c1c',
                            padding: '4px',
                            fontSize: '0.75rem',
                            borderRadius: '4px'
                          }}>
                            <span style={{ fontWeight: '500', marginRight: '4px' }}>
                              {alert.timeToCircuitBreaker.startsWith('+') ? '서킷브레이커 발생까지:' : '서킷브레이커 발생 후:'}
                            </span> 
                            <span style={{ fontWeight: 'bold' }}>{alert.timeToCircuitBreaker.replace(/^[+-]/, '')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ 
                padding: '16px', 
                backgroundColor: '#f9fafb', 
                borderRadius: '4px',
                textAlign: 'left',
                color: '#6b7280'
              }}>
                현재 임계값 기준으로 발생한 알림이 없습니다.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;