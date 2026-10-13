/* The reference ranges live in @wearwise/sensor-protocol (vitals.ts), shared with the
   researcher dashboard. Re-exported here so app code keeps one import path. */
export {
  VITAL_RANGES, classify, STATUS_LABEL, rangeText, activityLevel, ACTIVITY_LABEL,
  type VitalStatus, type VitalRange, type Activity,
} from '@wearwise/sensor-protocol';
