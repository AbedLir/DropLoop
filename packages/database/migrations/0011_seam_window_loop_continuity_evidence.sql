create or replace function is_valid_seam_window_loop_continuity_evidence(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  sampled_frame_count integer;
  seam_window_frame_count integer;
  seam_transition_mae double precision;
  seam_reference_mae double precision;
  seam_transition_ratio double precision;
  seam_jerk double precision;
  seam_reference_jerk double precision;
  seam_jerk_ratio double precision;
  seam_score integer;
begin
  if jsonb_typeof(candidate) <> 'object'
    or candidate ->> 'algorithmVersion' <> 'boundary-seam-window-gray-v3'
    or jsonb_typeof(candidate -> 'sampledFrameCount') <> 'number'
    or jsonb_typeof(candidate -> 'seamWindowFrameCount') <> 'number'
    or jsonb_typeof(candidate -> 'seamTransitionMaePercent') <> 'number'
    or jsonb_typeof(candidate -> 'seamReferenceP95MaePercent') <> 'number'
    or jsonb_typeof(candidate -> 'seamTransitionOutlierRatio') <> 'number'
    or jsonb_typeof(candidate -> 'seamJerkPercent') <> 'number'
    or jsonb_typeof(candidate -> 'seamReferenceP95JerkPercent') <> 'number'
    or jsonb_typeof(candidate -> 'seamJerkOutlierRatio') <> 'number'
    or jsonb_typeof(candidate -> 'seamContinuityScore') <> 'number'
    or jsonb_typeof(candidate -> 'policy') <> 'object'
    or jsonb_typeof(candidate -> 'policy' -> 'seamWindowSeconds') <> 'number'
    or jsonb_typeof(candidate -> 'policy' -> 'maxSeamTransitionOutlierRatio') <> 'number'
    or jsonb_typeof(candidate -> 'policy' -> 'maxSeamJerkOutlierRatio') <> 'number' then
    return false;
  end if;

  sampled_frame_count := (candidate ->> 'sampledFrameCount')::integer;
  seam_window_frame_count := (candidate ->> 'seamWindowFrameCount')::integer;
  seam_transition_mae := (candidate ->> 'seamTransitionMaePercent')::double precision;
  seam_reference_mae := (candidate ->> 'seamReferenceP95MaePercent')::double precision;
  seam_transition_ratio := (candidate ->> 'seamTransitionOutlierRatio')::double precision;
  seam_jerk := (candidate ->> 'seamJerkPercent')::double precision;
  seam_reference_jerk := (candidate ->> 'seamReferenceP95JerkPercent')::double precision;
  seam_jerk_ratio := (candidate ->> 'seamJerkOutlierRatio')::double precision;
  seam_score := (candidate ->> 'seamContinuityScore')::integer;

  return candidate -> 'policy' ->> 'algorithmVersion' = candidate ->> 'algorithmVersion'
    and sampled_frame_count >= 6
    and seam_window_frame_count between 3 and sampled_frame_count / 2
    and seam_transition_mae between 0 and 100
    and seam_reference_mae between 0 and 100
    and seam_transition_ratio >= 0
    and seam_jerk between 0 and 100
    and seam_reference_jerk between 0 and 100
    and seam_jerk_ratio >= 0
    and seam_score between 0 and 100
    and (candidate -> 'policy' ->> 'seamWindowSeconds')::double precision > 0
    and (candidate -> 'policy' ->> 'maxSeamTransitionOutlierRatio')::double precision > 1
    and (candidate -> 'policy' ->> 'maxSeamJerkOutlierRatio')::double precision > 1;
exception when others then
  return false;
end;
$$;

alter table asset_loop_analyses
  add constraint asset_loop_analyses_seam_window_v3_evidence
  check (
    algorithm_version <> 'boundary-seam-window-gray-v3'
    or is_valid_seam_window_loop_continuity_evidence(evidence)
  );

comment on constraint asset_loop_analyses_seam_window_v3_evidence on asset_loop_analyses is
  'The current loop gate persists evidence for the tail-window to head-window motion seam.';
