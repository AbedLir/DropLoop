create or replace function is_valid_temporal_loop_safety_evidence(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  sampled_frame_count integer;
  black_frame_count integer;
  sample_rate double precision;
  black_ratio double precision;
  maximum_brightness_jump double precision;
  p95_brightness_jump double precision;
  flash_reversal_count integer;
  flash_reversal_rate double precision;
  brightness_score integer;
  flicker_score integer;
begin
  if jsonb_typeof(candidate) <> 'object'
    or candidate ->> 'algorithmVersion' <> 'boundary-temporal-gray-v2'
    or jsonb_typeof(candidate -> 'sampleFramesPerSecond') <> 'number'
    or jsonb_typeof(candidate -> 'sampledFrameCount') <> 'number'
    or jsonb_typeof(candidate -> 'blackFrameCount') <> 'number'
    or jsonb_typeof(candidate -> 'blackFrameRatioPercent') <> 'number'
    or jsonb_typeof(candidate -> 'maxAdjacentBrightnessJumpPercent') <> 'number'
    or jsonb_typeof(candidate -> 'p95AdjacentBrightnessJumpPercent') <> 'number'
    or jsonb_typeof(candidate -> 'flashReversalCount') <> 'number'
    or jsonb_typeof(candidate -> 'flashReversalsPerSecond') <> 'number'
    or jsonb_typeof(candidate -> 'brightnessSafetyScore') <> 'number'
    or jsonb_typeof(candidate -> 'flickerSafetyScore') <> 'number'
    or jsonb_typeof(candidate -> 'policy') <> 'object'
    or jsonb_typeof(candidate -> 'policy' -> 'sampleFramesPerSecond') <> 'number'
    or jsonb_typeof(candidate -> 'policy' -> 'maxRepresentativeFrames') <> 'number'
    or jsonb_typeof(candidate -> 'policy' -> 'maxBlackFrameRatioPercent') <> 'number'
    or jsonb_typeof(candidate -> 'policy' -> 'maxAdjacentBrightnessJumpPercent') <> 'number'
    or jsonb_typeof(candidate -> 'policy' -> 'flashBrightnessDeltaPercent') <> 'number'
    or jsonb_typeof(candidate -> 'policy' -> 'maxFlashReversalsPerSecond') <> 'number' then
    return false;
  end if;

  sampled_frame_count := (candidate ->> 'sampledFrameCount')::integer;
  black_frame_count := (candidate ->> 'blackFrameCount')::integer;
  sample_rate := (candidate ->> 'sampleFramesPerSecond')::double precision;
  black_ratio := (candidate ->> 'blackFrameRatioPercent')::double precision;
  maximum_brightness_jump := (candidate ->> 'maxAdjacentBrightnessJumpPercent')::double precision;
  p95_brightness_jump := (candidate ->> 'p95AdjacentBrightnessJumpPercent')::double precision;
  flash_reversal_count := (candidate ->> 'flashReversalCount')::integer;
  flash_reversal_rate := (candidate ->> 'flashReversalsPerSecond')::double precision;
  brightness_score := (candidate ->> 'brightnessSafetyScore')::integer;
  flicker_score := (candidate ->> 'flickerSafetyScore')::integer;

  return candidate -> 'policy' ->> 'algorithmVersion' = candidate ->> 'algorithmVersion'
    and sample_rate > 0
    and sampled_frame_count >= 2
    and sampled_frame_count <= (candidate -> 'policy' ->> 'maxRepresentativeFrames')::integer + 1
    and black_frame_count between 0 and sampled_frame_count
    and black_ratio between 0 and 100
    and maximum_brightness_jump between 0 and 100
    and p95_brightness_jump between 0 and maximum_brightness_jump
    and flash_reversal_count >= 0
    and flash_reversal_rate >= 0
    and brightness_score between 0 and 100
    and flicker_score between 0 and 100;
exception when others then
  return false;
end;
$$;

alter table asset_loop_analyses
  drop constraint if exists asset_loop_analyses_temporal_v2_evidence;

alter table asset_loop_analyses
  add constraint asset_loop_analyses_temporal_v2_evidence
  check (
    algorithm_version <> 'boundary-temporal-gray-v2'
    or is_valid_temporal_loop_safety_evidence(evidence)
  );

comment on constraint asset_loop_analyses_temporal_v2_evidence on asset_loop_analyses is
  'The current temporal gate must persist complete representative-frame brightness and flicker evidence.';
