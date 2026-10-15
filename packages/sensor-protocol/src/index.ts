export * from './types.ts';
export { crc32 } from './crc32.ts';
export { encodePacket, decodePacket, peekPacketLength, uuidToBytes, bytesToUuid } from './codec.ts';
export { SequenceTracker, type SequenceVerdict } from './sequence.ts';
export {
  VITAL_RANGES, classify, STATUS_LABEL, rangeText, activityLevel, ACTIVITY_LABEL,
  type VitalStatus, type VitalRange, type Activity,
} from './vitals.ts';
