import React from 'react';
import { View } from 'react-native';
import { fill, orgMissing, type LegalDoc } from '@wearwise/legal';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Typo } from '@/shared/components/Typography';
import { Card } from '@/shared/components/Card';

/* One legal document (packages/legal), rendered with the app's type scale. The same
 * text and version the web dashboard shows. While the organisation's details aren't
 * filled in yet, a draft notice says so (and the gaps show as [placeholders]).
 */
export function LegalDocView({ doc }: { doc: LegalDoc }) {
  const { colors } = useTheme();
  const missing = orgMissing();
  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 4 }}>
        <Typo variant="h1" accessibilityRole="header">{doc.title}</Typo>
        <Typo variant="caption" color={colors.textMuted}>Effective {formatVersion(doc.version)}</Typo>
      </View>
      {missing.length > 0 && <DraftNotice />}
      <Typo variant="body" color={colors.textSecondary}>{fill(doc.summary)}</Typo>
      {doc.sections.map((section) => (
        <View key={section.heading} style={{ gap: 10 }}>
          <Typo variant="h3" accessibilityRole="header">{fill(section.heading)}</Typo>
          {section.blocks.map((b, i) => (
            typeof b === 'string' ? (
              <Typo key={i} variant="body">{fill(b)}</Typo>
            ) : 'list' in b ? (
              <View key={i} style={{ gap: 6 }}>
                {b.list.map((item, j) => (
                  <View key={j} style={{ flexDirection: 'row', gap: 10 }}>
                    <Typo variant="body" color={colors.textMuted}>•</Typo>
                    <Typo variant="body" style={{ flex: 1 }}>{fill(item)}</Typo>
                  </View>
                ))}
              </View>
            ) : (
              <Card key={i} style={{ backgroundColor: colors.surfaceInfo, borderColor: colors.borderInfoBlue }}>
                <Typo variant="body">{fill(b.note)}</Typo>
              </Card>
            )
          ))}
        </View>
      ))}
    </View>
  );
}

export function DraftNotice() {
  const { colors } = useTheme();
  return (
    <Card style={{ backgroundColor: colors.statusWarningBg, borderColor: colors.borderWarning, gap: 4 }}>
      <Typo variant="label" color={colors.statusWarningText}>Draft</Typo>
      <Typo variant="caption" color={colors.statusWarningText}>
        This document is being finalised. Some details, shown in [brackets], are still to be filled in.
      </Typo>
    </Card>
  );
}

/** "2026-10-16" → "16 October 2026". */
export function formatVersion(v: string): string {
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}
