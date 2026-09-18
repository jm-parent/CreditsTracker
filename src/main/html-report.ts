import type { ExportDailyPreviewRow, ExportReport, ExportSummaryRow, UsageFilters } from '../shared/types';

export interface HtmlReportOptions {
  filters: UsageFilters;
  generatedAt?: Date;
}

interface ProjectReportRow {
  project: string;
  aiuCredits: number;
  sharePercent: number;
}

interface ModelReportRow {
  model: string;
  aiuCredits: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  requests: number;
  sharePercent: number;
}

const EMPTY_SELECTION_MESSAGE = 'No usage for this selection.';
const EMPTY_SECTION_MESSAGE = 'No data available';
const CHART_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#f472b6', '#a78bfa', '#fb7185'];

export function renderHtmlReport(report: ExportReport, options: HtmlReportOptions): string {
  const generatedAt = options.generatedAt ?? new Date();
  const totalAiuCredits = safeNumber(report.preview.totals.aiuCredits);
  const projectRows = buildProjectRows(report.summaryRows, totalAiuCredits);
  const modelRows = buildModelRows(report.summaryRows, totalAiuCredits);
  const isEmpty = report.summaryRows.length === 0 && report.sessionRows.length === 0;

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Export report</title>
    <style>
      ${buildStyles()}
    </style>
  </head>
  <body>
    <main class="page">
      <header class="hero">
        <div>
          <p class="eyebrow">CreditsTracker</p>
          <h1>Export report</h1>
          <p class="subtitle">Standalone usage dashboard with inline styles and no external resources.</p>
        </div>
        <dl class="metadata">
          <div>
            <dt>Period</dt>
            <dd>${escapeHtml(formatSelectedPeriod(options.filters))}</dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>${escapeHtml(options.filters.project ?? 'All projects')}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>${escapeHtml(options.filters.model ?? 'All models')}</dd>
          </div>
          <div>
            <dt>Generated</dt>
            <dd>${escapeHtml(formatDate(generatedAt))}</dd>
          </div>
        </dl>
      </header>

      ${isEmpty ? `<p class="global-empty">${EMPTY_SELECTION_MESSAGE}</p>` : ''}

      <section class="card-grid" aria-label="Key performance indicators">
        ${renderKpiCard('AIU credits', formatCredits(report.preview.totals.aiuCredits))}
        ${renderKpiCard('Tokens', formatTokens(report.preview.totals.tokens))}
        ${renderKpiCard('Requests', formatTokens(report.preview.totals.requests))}
        ${renderKpiCard('Sessions', formatTokens(report.preview.sessionCount))}
        ${renderKpiCard('Active days', formatTokens(report.preview.activeDays))}
      </section>

      <section id="daily-consumption" class="section card">
        <div class="section-heading">
          <h2>Daily consumption</h2>
          <p>AIU credits by day for the current selection.</p>
        </div>
        ${renderDailyConsumption(report.preview.daily)}
      </section>

      <section id="model-breakdown" class="section card">
        <div class="section-heading">
          <h2>Model breakdown</h2>
          <p>AIU credit share aggregated across all summary rows.</p>
        </div>
        ${renderModelBreakdown(modelRows)}
      </section>

      <section id="project-consumption" class="section card">
        <div class="section-heading">
          <h2>Project consumption</h2>
          <p>Projects ranked by AIU credits for the selected export.</p>
        </div>
        ${renderProjectConsumption(projectRows)}
      </section>

      <section id="token-ratio" class="section card">
        <div class="section-heading">
          <h2>Token ratio</h2>
          <p>Input and output token composition by model.</p>
        </div>
        ${renderTokenRatio(modelRows)}
      </section>

      <section id="execution-details" class="section card">
        <div class="section-heading">
          <h2>Execution details</h2>
          <p>Escaped session-level details for the selection.</p>
        </div>
        ${renderExecutionDetails(report)}
      </section>
    </main>
  </body>
</html>`;
}

function buildProjectRows(summaryRows: ExportSummaryRow[], totalAiuCredits: number): ProjectReportRow[] {
  const totalsByProject = new Map<string, number>();

  for (const row of summaryRows) {
    totalsByProject.set(row.project, safeNumber(totalsByProject.get(row.project) ?? 0) + safeNumber(row.aiuCredits));
  }

  return [...totalsByProject.entries()]
    .map(([project, aiuCredits]) => ({
      project,
      aiuCredits: safeNumber(aiuCredits),
      sharePercent: totalAiuCredits > 0 ? safeNumber((aiuCredits / totalAiuCredits) * 100) : 0,
    }))
    .sort(compareRows);
}

function buildModelRows(summaryRows: ExportSummaryRow[], totalAiuCredits: number): ModelReportRow[] {
  const totalsByModel = new Map<string, Omit<ModelReportRow, 'sharePercent'>>();

  for (const row of summaryRows) {
    const current = totalsByModel.get(row.model) ?? {
      model: row.model,
      aiuCredits: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokens: 0,
      requests: 0,
    };
    current.aiuCredits += safeNumber(row.aiuCredits);
    current.inputTokens += safeNumber(row.inputTokens);
    current.outputTokens += safeNumber(row.outputTokens);
    current.tokens += safeNumber(row.tokens);
    current.requests += safeNumber(row.requests);
    totalsByModel.set(row.model, current);
  }

  return [...totalsByModel.values()]
    .map((row) => ({
      ...row,
      aiuCredits: safeNumber(row.aiuCredits),
      inputTokens: safeNumber(row.inputTokens),
      outputTokens: safeNumber(row.outputTokens),
      tokens: safeNumber(row.tokens),
      requests: safeNumber(row.requests),
      sharePercent: totalAiuCredits > 0 ? safeNumber((row.aiuCredits / totalAiuCredits) * 100) : 0,
    }))
    .sort(compareRows);
}

function compareRows(
  left: Pick<ProjectReportRow, 'aiuCredits' | 'project'> | Pick<ModelReportRow, 'aiuCredits' | 'model'>,
  right: Pick<ProjectReportRow, 'aiuCredits' | 'project'> | Pick<ModelReportRow, 'aiuCredits' | 'model'>,
): number {
  const score = safeNumber(right.aiuCredits) - safeNumber(left.aiuCredits);
  if (score !== 0) {
    return score;
  }

  const leftLabel = 'project' in left ? left.project : left.model;
  const rightLabel = 'project' in right ? right.project : right.model;
  return leftLabel.localeCompare(rightLabel);
}

function renderKpiCard(label: string, value: string): string {
  return `<article class="kpi card">
    <p class="kpi-label">${escapeHtml(label)}</p>
    <p class="kpi-value">${escapeHtml(value)}</p>
  </article>`;
}

function renderDailyConsumption(dailyRows: ExportDailyPreviewRow[]): string {
  const rows = dailyRows.map((row) => ({
    date: row.date,
    aiuCredits: safeNumber(row.aiuCredits),
  }));
  const maxValue = Math.max(0, ...rows.map((row) => row.aiuCredits));

  if (rows.length === 0 || maxValue <= 0) {
    return renderSectionEmptyState(EMPTY_SECTION_MESSAGE);
  }

  const width = 720;
  const height = 260;
  const left = 56;
  const top = 20;
  const chartWidth = 620;
  const chartHeight = 180;
  const bottom = top + chartHeight;
  const step = rows.length === 1 ? 0 : chartWidth / (rows.length - 1);
  const points = rows.map((row, index) => {
    const x = left + step * index;
    const ratio = maxValue > 0 ? row.aiuCredits / maxValue : 0;
    const y = bottom - chartHeight * ratio;
    return {
      x: safeNumber(x),
      y: safeNumber(y),
      date: row.date,
      value: row.aiuCredits,
    };
  });
  const polylinePoints = points.map((point) => `${formatCoordinate(point.x)},${formatCoordinate(point.y)}`).join(' ');
  const areaPoints = [
    `${formatCoordinate(points[0]?.x ?? left)},${formatCoordinate(bottom)}`,
    polylinePoints,
    `${formatCoordinate(points[points.length - 1]?.x ?? left)},${formatCoordinate(bottom)}`,
  ].join(' ');
  const yAxisLabels = [0, maxValue / 2, maxValue].map((value) => safeNumber(value));

  return `<div class="chart-block">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="daily-consumption-title daily-consumption-desc">
      <title id="daily-consumption-title">Daily AIU credits</title>
      <desc id="daily-consumption-desc">Daily AIU credit totals for the selected export period.</desc>
      ${yAxisLabels
        .map((value) => {
          const y = bottom - (maxValue > 0 ? chartHeight * (value / maxValue) : 0);
          return `<line x1="${formatCoordinate(left)}" y1="${formatCoordinate(y)}" x2="${formatCoordinate(left + chartWidth)}" y2="${formatCoordinate(y)}" class="grid-line"></line>
          <text x="${formatCoordinate(left - 12)}" y="${formatCoordinate(y + 4)}" text-anchor="end" class="axis-label">${escapeHtml(formatCredits(value))}</text>`;
        })
        .join('')}
      <polygon points="${areaPoints}" class="area-fill"></polygon>
      <polyline points="${polylinePoints}" class="line-stroke"></polyline>
      ${points
        .map(
          (point) => `<circle cx="${formatCoordinate(point.x)}" cy="${formatCoordinate(point.y)}" r="4" class="point-fill">
            <title>${escapeHtml(`${point.date}: ${formatCredits(point.value)} AIU`)}</title>
          </circle>`,
        )
        .join('')}
      ${points
        .map(
          (point) => `<text x="${formatCoordinate(point.x)}" y="${formatCoordinate(bottom + 22)}" text-anchor="middle" class="axis-label">${escapeHtml(
            point.date,
          )}</text>`,
        )
        .join('')}
    </svg>
  </div>`;
}

function renderModelBreakdown(modelRows: ModelReportRow[]): string {
  const total = modelRows.reduce((sum, row) => sum + safeNumber(row.aiuCredits), 0);

  if (modelRows.length === 0 || total <= 0) {
    return renderSectionEmptyState(EMPTY_SECTION_MESSAGE);
  }

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  const rings = modelRows
    .map((row, index) => {
      const length = safeNumber((row.aiuCredits / total) * circumference);
      const dash = Math.max(0, Math.min(circumference, length));
      const offset = -safeNumber(consumed);
      consumed += dash;
      return `<circle
        cx="80"
        cy="80"
        r="${formatCoordinate(radius)}"
        fill="none"
        stroke="${CHART_COLORS[index % CHART_COLORS.length]}"
        stroke-width="22"
        stroke-dasharray="${formatCoordinate(dash)} ${formatCoordinate(circumference)}"
        stroke-dashoffset="${formatCoordinate(offset)}"
        transform="rotate(-90 80 80)"
      >
        <title>${escapeHtml(`${row.model}: ${formatCredits(row.aiuCredits)} AIU (${formatPercent(row.sharePercent)})`)}</title>
      </circle>`;
    })
    .join('');

  return `<div class="split-layout">
    <svg viewBox="0 0 160 160" role="img" aria-labelledby="model-breakdown-title model-breakdown-desc" class="donut-chart">
      <title id="model-breakdown-title">AIU credit share by model</title>
      <desc id="model-breakdown-desc">Donut chart showing AIU credit share by model.</desc>
      <circle cx="80" cy="80" r="${formatCoordinate(radius)}" fill="none" stroke="#1f2a44" stroke-width="22"></circle>
      ${rings}
      <text x="80" y="74" text-anchor="middle" class="donut-total-label">Total</text>
      <text x="80" y="94" text-anchor="middle" class="donut-total-value">${escapeHtml(formatCredits(total))}</text>
    </svg>
    <ul class="legend">
      ${modelRows
        .map(
          (row, index) => `<li>
            <span class="legend-swatch" style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></span>
            <div>
              <strong>${escapeHtml(row.model)}</strong>
              <span>${escapeHtml(formatCredits(row.aiuCredits))} · ${escapeHtml(formatPercent(row.sharePercent))}</span>
            </div>
          </li>`,
        )
        .join('')}
    </ul>
  </div>`;
}

function renderProjectConsumption(projectRows: ProjectReportRow[]): string {
  if (projectRows.length === 0) {
    return renderSectionEmptyState(EMPTY_SECTION_MESSAGE);
  }

  return `<div class="bar-list">
    ${projectRows
      .map((row) => `<article class="bar-item">
        <div class="bar-meta">
          <strong>${escapeHtml(row.project)}</strong>
          <span>${escapeHtml(formatCredits(row.aiuCredits))} · ${escapeHtml(formatPercent(row.sharePercent))}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${formatCoordinate(row.sharePercent)}%"></div>
        </div>
      </article>`)
      .join('')}
  </div>`;
}

function renderTokenRatio(modelRows: ModelReportRow[]): string {
  if (modelRows.length === 0) {
    return renderSectionEmptyState(EMPTY_SECTION_MESSAGE);
  }

  return `<div class="token-ratio-list">
    ${modelRows
      .map((row) => {
        const totalTokens = safeNumber(row.tokens);
        const inputPercent = totalTokens > 0 ? safeNumber((row.inputTokens / totalTokens) * 100) : 0;
        const outputPercent = totalTokens > 0 ? safeNumber((row.outputTokens / totalTokens) * 100) : 0;
        return `<article class="token-ratio-item">
          <div class="bar-meta">
            <strong>${escapeHtml(row.model)}</strong>
            <span>${escapeHtml(formatTokens(totalTokens))} tokens · ${escapeHtml(formatTokens(row.requests))} requests</span>
          </div>
          <div class="stacked-track" aria-label="${escapeHtml(row.model)} token ratio">
            <div class="stacked-input" style="width:${formatCoordinate(inputPercent)}%"></div>
            <div class="stacked-output" style="width:${formatCoordinate(outputPercent)}%"></div>
          </div>
          <div class="token-ratio-values">
            <span>Input ${escapeHtml(formatTokens(row.inputTokens))} (${escapeHtml(formatPercent(inputPercent))})</span>
            <span>Output ${escapeHtml(formatTokens(row.outputTokens))} (${escapeHtml(formatPercent(outputPercent))})</span>
          </div>
        </article>`;
      })
      .join('')}
  </div>`;
}

function renderExecutionDetails(report: ExportReport): string {
  if (report.sessionRows.length === 0) {
    return `<p class="empty-state">${EMPTY_SELECTION_MESSAGE}</p>`;
  }

  return `<div class="table-scroll">
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Created</th>
          <th>Project</th>
          <th>Models</th>
          <th>AIU</th>
          <th>Input tokens</th>
          <th>Output tokens</th>
          <th>Tokens</th>
          <th>Requests</th>
          <th>Summary</th>
        </tr>
      </thead>
      <tbody>
        ${report.sessionRows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(row.date)}</td>
              <td>${escapeHtml(row.createdAt)}</td>
              <td>${escapeHtml(row.project)}</td>
              <td>${escapeHtml(row.models)}</td>
              <td>${escapeHtml(formatCredits(row.aiuCredits))}</td>
              <td>${escapeHtml(formatTokens(row.inputTokens))}</td>
              <td>${escapeHtml(formatTokens(row.outputTokens))}</td>
              <td>${escapeHtml(formatTokens(row.tokens))}</td>
              <td>${escapeHtml(formatTokens(row.requests))}</td>
              <td class="summary-cell">${escapeHtml(row.summary)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function renderSectionEmptyState(message: string): string {
  return `<p class="empty-state">${escapeHtml(message)}</p>`;
}

function formatSelectedPeriod(filters: UsageFilters): string {
  if (filters.from && filters.to) {
    return `${filters.from} → ${filters.to}`;
  }
  if (filters.from) {
    return `From ${filters.from}`;
  }
  if (filters.to) {
    return `Until ${filters.to}`;
  }
  return 'All dates';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatCredits(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(safeNumber(value));
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(safeNumber(value)));
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: safeNumber(value) > 0 && safeNumber(value) < 10 ? 1 : 0,
    maximumFractionDigits: 2,
  }).format(safeNumber(value))}%`;
}

function formatDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes} UTC`;
}

function formatCoordinate(value: number): string {
  return safeNumber(value).toFixed(2);
}

function buildStyles(): string {
  return `
      :root {
        color-scheme: dark;
        --bg: #020817;
        --panel: #0f172a;
        --panel-strong: #111c34;
        --border: #1e293b;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #60a5fa;
        --accent-soft: rgba(96, 165, 250, 0.18);
        --success: #34d399;
        --warning: #f59e0b;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: Inter, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #020617 0%, #0f172a 100%);
        color: var(--text);
      }

      .page {
        margin: 0 auto;
        max-width: 1120px;
        padding: 32px 20px 48px;
      }

      .hero,
      .card,
      .kpi {
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid var(--border);
        border-radius: 18px;
        box-shadow: 0 18px 40px rgba(2, 6, 23, 0.28);
      }

      .hero {
        display: flex;
        flex-wrap: wrap;
        gap: 24px;
        justify-content: space-between;
        padding: 28px;
        margin-bottom: 24px;
      }

      .eyebrow,
      .subtitle,
      .metadata dt,
      .section-heading p,
      .kpi-label,
      .empty-state,
      .global-empty,
      .axis-label,
      .donut-total-label,
      .token-ratio-values,
      .bar-meta span,
      .legend span {
        color: var(--muted);
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      h1 {
        font-size: 2rem;
        margin-top: 8px;
      }

      .subtitle {
        margin-top: 12px;
        max-width: 48rem;
        line-height: 1.5;
      }

      .metadata {
        display: grid;
        gap: 12px;
        min-width: min(100%, 280px);
      }

      .metadata div {
        background: var(--panel-strong);
        border-radius: 14px;
        padding: 12px 14px;
      }

      .metadata dt {
        font-size: 0.8rem;
        margin-bottom: 4px;
      }

      .metadata dd {
        margin: 0;
        font-weight: 600;
      }

      .global-empty {
        margin: 0 0 24px;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px dashed var(--border);
        background: rgba(15, 23, 42, 0.6);
      }

      .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
      }

      .kpi {
        padding: 18px;
      }

      .kpi-value {
        font-size: 1.7rem;
        font-weight: 700;
        margin-top: 8px;
      }

      .section {
        padding: 22px;
        margin-bottom: 20px;
      }

      .section-heading {
        margin-bottom: 18px;
      }

      .section-heading h2 {
        margin-bottom: 6px;
      }

      .chart-block,
      .split-layout,
      .table-scroll,
      .bar-list,
      .token-ratio-list {
        width: 100%;
      }

      svg {
        display: block;
        width: 100%;
        height: auto;
      }

      .grid-line {
        stroke: rgba(148, 163, 184, 0.18);
        stroke-width: 1;
      }

      .area-fill {
        fill: rgba(96, 165, 250, 0.18);
      }

      .line-stroke {
        fill: none;
        stroke: var(--accent);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .point-fill {
        fill: var(--accent);
      }

      .split-layout {
        display: grid;
        grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
        gap: 20px;
        align-items: center;
      }

      .legend {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 12px;
      }

      .legend li {
        display: flex;
        gap: 12px;
        align-items: center;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 14px;
      }

      .legend-swatch {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        flex: none;
      }

      .legend strong,
      .bar-meta strong {
        display: block;
        margin-bottom: 4px;
      }

      .donut-total-label,
      .donut-total-value {
        font-size: 0.85rem;
        font-weight: 600;
      }

      .donut-total-value {
        fill: var(--text);
      }

      .bar-list,
      .token-ratio-list {
        display: grid;
        gap: 16px;
      }

      .bar-item,
      .token-ratio-item {
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
      }

      .bar-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .bar-track,
      .stacked-track {
        overflow: hidden;
        background: rgba(30, 41, 59, 0.8);
        border-radius: 999px;
        min-height: 14px;
      }

      .bar-fill {
        min-height: 14px;
        background: linear-gradient(90deg, #60a5fa 0%, #34d399 100%);
      }

      .stacked-track {
        display: flex;
      }

      .stacked-input {
        min-height: 16px;
        background: var(--accent);
      }

      .stacked-output {
        min-height: 16px;
        background: var(--success);
      }

      .token-ratio-values {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 10px;
        flex-wrap: wrap;
      }

      .table-scroll {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 960px;
      }

      th,
      td {
        padding: 12px 14px;
        text-align: left;
        border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        vertical-align: top;
      }

      th {
        color: #cbd5e1;
        font-size: 0.82rem;
      }

      .summary-cell {
        max-width: 340px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .empty-state {
        padding: 18px;
        border: 1px dashed var(--border);
        border-radius: 14px;
        background: rgba(15, 23, 42, 0.45);
      }

      @media (max-width: 720px) {
        .page {
          padding: 20px 14px 32px;
        }

        .hero,
        .section {
          padding: 18px;
        }

        .split-layout {
          grid-template-columns: 1fr;
        }

        .bar-meta,
        .token-ratio-values {
          flex-direction: column;
        }
      }

      @media print {
        body {
          background: #ffffff;
          color: #111827;
        }

        .hero,
        .card,
        .kpi,
        .bar-item,
        .token-ratio-item,
        .legend li,
        .global-empty,
        .empty-state {
          box-shadow: none;
          background: #ffffff;
          border-color: #cbd5e1;
        }

        .eyebrow,
        .subtitle,
        .metadata dt,
        .section-heading p,
        .kpi-label,
        .axis-label,
        .token-ratio-values,
        .bar-meta span,
        .legend span,
        .empty-state,
        .global-empty {
          color: #475569;
        }

        .page {
          max-width: none;
          padding: 0;
        }
      }`;
}
