import React from 'react';
import { View } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { SignalTrace } from './SignalTrace';

/* ECG on ECG paper: the familiar small/large-square grid behind the trace, so the
 * rhythm reads like a strip. One large square = 0.2 s across (five small squares of
 * 0.04 s), the paper-speed convention every clinician knows; squares stay square, so
 * the vertical grid matches. The trace autoscales — the patch's amplitude is not
 * calibrated in mV, so a voltage grid would claim precision it does not have.
 *
 * The grid is static (built once per size); the waveform is SignalTrace, drawn on the
 * UI thread like every other live trace.
 */

const MAJOR_S = 0.2;
const MINOR_PER_MAJOR = 5;

export function EcgGraph({ data, rateHz, windowSec = 3, height = 160 }: {
  data: readonly number[]; rateHz: number; windowSec?: number; height?: number;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = React.useState(0);

  /* Only the newest `windowSec` of the engine's rolling buffer — a 3 s strip shows
     each beat clearly; the full 6 s buffer squeezes them together on a phone. */
  const n = Math.max(2, Math.round(windowSec * (rateHz > 0 ? rateHz : 250)));
  const strip = React.useMemo(() => (data.length > n ? data.slice(data.length - n) : data), [data, n]);

  const grid = React.useMemo(() => {
    if (!width) return null;
    const major = width / (windowSec / MAJOR_S);
    const minor = major / MINOR_PER_MAJOR;
    const small = Skia.PathBuilder.Make();
    const large = Skia.PathBuilder.Make();
    for (let i = 0, x = 0; x <= width + 0.5; i++, x = i * minor) {
      (i % MINOR_PER_MAJOR === 0 ? large : small).moveTo(x, 0).lineTo(x, height);
    }
    for (let i = 0, y = height; y >= -0.5; i++, y = height - i * minor) {
      (i % MINOR_PER_MAJOR === 0 ? large : small).moveTo(0, y).lineTo(width, y);
    }
    return { small: small.detach(), large: large.detach() };
  }, [width, height, windowSec]);

  return (
    <View style={{ height, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surfaceSubtle }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {grid && (
        <Canvas style={{ position: 'absolute', width, height }}>
          <Path path={grid.small} color={colors.wwDataHeart} style="stroke" strokeWidth={0.5} opacity={0.18} />
          <Path path={grid.large} color={colors.wwDataHeart} style="stroke" strokeWidth={1} opacity={0.38} />
        </Canvas>
      )}
      <SignalTrace data={strip} color={colors.textHeading} height={height} fill={false} gridlines={0} />
    </View>
  );
}
