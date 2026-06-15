import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10, color: '#1F2937' },
  header: { marginBottom: 20, borderBottom: '2px solid #2563EB', paddingBottom: 12 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#0A1628', marginBottom: 4 },
  subtitle: { fontSize: 11, color: '#6B7280' },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#374151', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, borderBottom: '1px solid #E5E7EB', paddingBottom: 4 },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryCard: { flex: 1, padding: 10, borderRadius: 6, alignItems: 'center' },
  summaryNum: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  summaryLabel: { fontSize: 8, textAlign: 'center' },
  table: { border: '1px solid #E5E7EB', borderRadius: 4, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB', padding: '6 8' },
  tableRow: { flexDirection: 'row', borderBottom: '1px solid #F3F4F6', padding: '6 8' },
  tableCell: { flex: 1, fontSize: 9, color: '#374151' },
  tableCellBold: { flex: 1, fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' },
  tableHeaderCell: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6B7280', textTransform: 'uppercase' },
  narrative: { fontSize: 10, lineHeight: 1.6, color: '#374151' },
  pill: { fontSize: 8, padding: '2 6', borderRadius: 10 },
  pillGreen: { color: '#16A34A' },
  pillRed: { color: '#DC2626' },
  pillGray: { color: '#64748B' },
  pillYellow: { color: '#D97706' },
  serviceJustification: { padding: 10, borderRadius: 6, marginBottom: 12, border: '1px solid #A7F3D0', backgroundColor: '#F0FDF4' },
  serviceJustificationText: { fontSize: 10, color: '#065F46', fontFamily: 'Helvetica-Bold' },
  priorityItem: { fontSize: 10, color: '#374151', marginBottom: 4 },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, borderTop: '1px solid #E5E7EB', paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 8, color: '#9CA3AF' },
});

function trendLabel(trend: string) {
  if (trend === 'improving') return '↓ Improving';
  if (trend === 'worsening') return '↑ Worsening';
  if (trend === 'stable') return '→ Stable';
  return '— Insufficient Data';
}

function trendStyle(trend: string) {
  if (trend === 'improving') return styles.pillGreen;
  if (trend === 'worsening') return styles.pillRed;
  if (trend === 'stable') return styles.pillGray;
  return styles.pillYellow;
}

interface Props {
  clientCode: string;
  periodLabel: string;
  generatedAt: string;
  behaviorTrends: any[];
  skillTrends: any[];
  goalProgress: any[];
  narrative: string;
  clinicalProfile: any;
}

export function ProgressReportPDF({ clientCode, periodLabel, generatedAt, behaviorTrends, skillTrends, goalProgress, narrative, clinicalProfile }: Props) {
  const improving = behaviorTrends.filter(b => b.trend === 'improving').length;
  const worsening = behaviorTrends.filter(b => b.trend === 'worsening').length;
  const skillsImproving = skillTrends.filter(s => s.trend === 'improving').length;
  const mastered = goalProgress.filter(g => g.goalStatus === 'Mastered').length;

  function getBehaviorFunction(name: string) {
    const b = (clinicalProfile?.maladaptiveBehaviors || []).find((bx: any) =>
      (typeof bx === 'string' ? bx : bx?.name || '').toLowerCase() === name.toLowerCase()
    );
    if (!b || typeof b === 'string') return '—';
    const funcs = b.functions || b.function || [];
    return Array.isArray(funcs) ? funcs.join(', ') : funcs || '—';
  }

  function getBehaviorIntervention() {
    const interventions = (clinicalProfile?.interventions || []).slice(0, 2).map((i: any) => typeof i === 'string' ? i : i?.name || '').filter(Boolean);
    return interventions.join(', ') || 'Per treatment plan';
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Monthly Progress Report</Text>
          <Text style={styles.subtitle}>{periodLabel} · Client: {clientCode} · Generated: {generatedAt}</Text>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryRow}>
          {[
            { label: 'Behaviors Improved', value: improving, color: '#16A34A', bg: '#DCFCE7' },
            { label: 'Need Attention', value: worsening, color: '#DC2626', bg: '#FEE2E2' },
            { label: 'Skills Improving', value: skillsImproving, color: '#2563EB', bg: '#EFF6FF' },
            { label: 'Goals Mastered', value: mastered, color: '#7C3AED', bg: '#EEF2FF' },
          ].map((card, i) => (
            <View key={i} style={[styles.summaryCard, { backgroundColor: card.bg }]}>
              <Text style={[styles.summaryNum, { color: card.color }]}>{card.value}</Text>
              <Text style={[styles.summaryLabel, { color: card.color }]}>{card.label}</Text>
            </View>
          ))}
        </View>

        {/* Service Justification */}
        <View style={styles.serviceJustification}>
          <Text style={styles.serviceJustificationText}>✓ Continued ABA services remain clinically indicated at the current authorized intensity.</Text>
        </View>

        {/* Maladaptive Behaviors Table */}
        {behaviorTrends.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Maladaptive Behaviors</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                {['Behavior', 'Function', 'Intervention', 'Baseline', 'Current', 'Trend'].map(h => (
                  <Text key={h} style={styles.tableHeaderCell}>{h}</Text>
                ))}
              </View>
              {behaviorTrends.map((b, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={styles.tableCellBold}>{b.name}</Text>
                  <Text style={styles.tableCell}>{getBehaviorFunction(b.name)}</Text>
                  <Text style={styles.tableCell}>{getBehaviorIntervention()}</Text>
                  <Text style={styles.tableCell}>{b.weeklyFrequencies?.[0] ?? '—'}/wk</Text>
                  <Text style={styles.tableCell}>{b.weeklyFrequencies?.[b.weeklyFrequencies.length - 1] ?? '—'}/wk</Text>
                  <Text style={[styles.tableCell, trendStyle(b.trend)]}>{trendLabel(b.trend)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Replacement Skills Table */}
        {skillTrends.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Replacement Skills</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                {['Skill', 'Baseline', 'Current', 'Goal', 'Trend'].map(h => (
                  <Text key={h} style={styles.tableHeaderCell}>{h}</Text>
                ))}
              </View>
              {skillTrends.map((s, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={styles.tableCellBold}>{s.name}</Text>
                  <Text style={styles.tableCell}>{s.weeklyPercentages?.[0]?.toFixed(0) ?? '—'}%</Text>
                  <Text style={styles.tableCell}>{s.avgPercentage.toFixed(0)}%</Text>
                  <Text style={styles.tableCell}>{goalProgress.find(g => g.targetName === s.name)?.goalValue ?? '—'}%</Text>
                  <Text style={[styles.tableCell, trendStyle(s.trend)]}>{trendLabel(s.trend)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Clinical Narrative */}
        {narrative && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clinical Narrative & Medical Necessity</Text>
            <Text style={styles.narrative}>{narrative}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Path4ABA · {periodLabel} · {clientCode}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
