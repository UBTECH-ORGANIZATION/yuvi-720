import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
)

const colors = ['#818cf8', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#38bdf8']
const tooltip = {
  backgroundColor: '#171a35',
  titleColor: '#f4f5ff',
  bodyColor: '#a6abc9',
  borderColor: 'rgba(124, 92, 252, 0.35)',
  borderWidth: 1,
  padding: 12,
  cornerRadius: 10,
}

export function ActivityChart({
  labels,
  requests,
  tokens,
  requestsLabel,
  tokensLabel,
  ariaLabel,
}: {
  labels: string[]
  requests: number[]
  tokens: number[]
  requestsLabel: string
  tokensLabel: string
  ariaLabel: string
}) {
  const data: ChartData<'line'> = {
    labels,
    datasets: [
      {
        label: requestsLabel,
        data: requests,
        borderColor: '#818cf8',
        backgroundColor: 'rgba(129, 140, 248, 0.18)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 6,
        yAxisID: 'requests',
      },
      {
        label: tokensLabel,
        data: tokens,
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34, 211, 238, 0.08)',
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 6,
        yAxisID: 'tokens',
      },
    ],
  }
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', align: 'end', labels: { color: '#8f94b5', usePointStyle: true, boxWidth: 8 } },
      tooltip,
    },
    scales: {
      x: { border: { display: false }, grid: { display: false }, ticks: { color: '#626785', maxRotation: 0 } },
      requests: { beginAtZero: true, position: 'left', border: { display: false }, grid: { color: 'rgba(255,255,255,0.045)' }, ticks: { color: '#626785', precision: 0 } },
      tokens: { beginAtZero: true, position: 'right', border: { display: false }, grid: { display: false }, ticks: { color: '#626785' } },
    },
  }
  return <div className="chart-canvas" role="img" aria-label={ariaLabel}><Line data={data} options={options} /></div>
}

export function DistributionChart({
  labels,
  values,
  ariaLabel,
}: {
  labels: string[]
  values: number[]
  ariaLabel: string
}) {
  const data: ChartData<'doughnut'> = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: colors.slice(0, values.length),
      borderColor: '#141630',
      borderWidth: 4,
      hoverBorderColor: '#ffffff',
      hoverOffset: 6,
      spacing: 2,
    }],
  }
  const options: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: { position: 'bottom', labels: { color: '#8f94b5', usePointStyle: true, boxWidth: 8, padding: 16 } },
      tooltip,
    },
  }
  return <div className="chart-canvas" role="img" aria-label={ariaLabel}><Doughnut data={data} options={options} /></div>
}

export function RankingChart({
  labels,
  values,
  ariaLabel,
}: {
  labels: string[]
  values: number[]
  ariaLabel: string
}) {
  const data: ChartData<'bar'> = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: values.map((_, index) => colors[index % colors.length]),
      borderRadius: 7,
      borderSkipped: false,
      barThickness: 16,
    }],
  }
  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: { legend: { display: false }, tooltip },
    scales: {
      x: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(255,255,255,0.045)' }, ticks: { color: '#626785' } },
      y: { border: { display: false }, grid: { display: false }, ticks: { color: '#a6abc9' } },
    },
  }
  return <div className="chart-canvas" role="img" aria-label={ariaLabel}><Bar data={data} options={options} /></div>
}