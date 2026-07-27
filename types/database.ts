// ─── Supabase Database Types ─────────────────────────────────────────────────
// These types mirror the Supabase schema exactly.
// Generated manually to avoid Supabase CLI dependency during development.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// ─── Enums ────────────────────────────────────────────────────────────────────

export type OrgPlan = "FREE" | "BUILDER" | "STUDIO" | "AGENCY";
export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";
export type ProjectFramework =
  | "NEXTJS"
  | "REACT"
  | "VUE"
  | "SVELTE"
  | "NUXT"
  | "REMIX"
  | "ASTRO"
  | "OTHER";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "unpaid";
export type ScanType = "full" | "incremental" | "file";
export type ScanStatus =
  | "queued"
  | "fetching_repository"
  | "indexing"
  | "scanning"
  | "calculating_score"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingConfidence = "high" | "medium" | "low";
export type FindingStatus = "open" | "fixed" | "ignored" | "false_positive";
export type FindingCategory = string;

// ─── Row Types (what comes out of the DB) ────────────────────────────────────

export type ProfileRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  locale: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  logo_url: string | null;
  verdict_autopilot_enabled?: boolean;
  created_at: string;
  updated_at: string;
};

export type OrganizationMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
};

export type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  github_repo: string | null;
  production_url: string | null;
  framework: ProjectFramework | null;
  github_repository_id: number | null;
  github_default_branch: string | null;
  github_last_commit_sha: string | null;
  github_is_private: boolean | null;
  github_connected_at: string | null;
  security_score: number | null;
  last_scan_at: string | null;
  webhook_enabled?: boolean | null;
  repository_health?: string | null;
  github_webhook_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionRow = {
  id: string;
  organization_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: OrgPlan;
  status: SubscriptionStatus;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
};

export type ScanRow = {
  id: string;
  organization_id: string;
  project_id: string;
  repository_id: string;
  triggered_by_user_id: string;
  trigger_type: "manual" | "webhook" | "scheduled" | "mcp";
  review_type: "manual" | "automatic";
  scan_type: ScanType;
  status: ScanStatus;
  progress: number;
  progress_message: string | null;
  branch: string | null;
  commit_sha: string | null;
  security_score: number | null;
  score_breakdown: Json;
  detected_stack: Json;
  omissions: Json;
  metrics: Json;
  summary: string | null;
  files_discovered: number;
  files_analyzed: number;
  findings_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  info_count: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  progress_at_cancellation: number | null;
  last_completed_phase: string | null;
  created_at: string;
  updated_at: string;
};

export type ScanFindingRow = {
  id: string;
  scan_id: string;
  organization_id: string;
  project_id: string;
  repository_id: string;
  rule_id: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  category: FindingCategory;
  title: string;
  description: string;
  impact: string | null;
  recommendation: string;
  file_path: string;
  start_line: number;
  end_line: number | null;
  code_snippet: string | null;
  evidence: string | null;
  fingerprint: string;
  status: FindingStatus;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type RepositoryScanStateRow = {
  id: string;
  repository_id: string;
  organization_id: string;
  active_scan_id: string | null;
  last_scan_id: string | null;
  last_commit_sha: string | null;
  last_full_scan_at: string | null;
  last_security_score: number | null;
  open_findings_count: number;
  created_at: string;
  updated_at: string;
};

export type RepositoryHealthRow = {
  id: string;
  organization_id: string;
  project_id: string;
  health_status: "excellent" | "good" | "needs_attention" | "critical";
  security_score: number | null;
  risk_score: number | null;
  open_findings_count: number;
  critical_open_count: number;
  score_trend: number;
  factors: Json;
  calculated_at: string;
  updated_at: string;
};

export type RepositoryActivityRow = {
  id: string;
  organization_id: string;
  project_id: string;
  scan_id: string | null;
  event_type: string;
  title: string;
  description: string | null;
  metadata: Json;
  occurred_at: string;
  created_at: string;
};

export type SecurityNotificationRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  user_id: string | null;
  channel: "in_app" | "email" | "slack" | "discord";
  notification_type: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  read_at: string | null;
  delivered_at: string | null;
  metadata: Json;
  created_at: string;
};

// ─── Insert Types (what you send to create a row) ────────────────────────────

export type ProfileInsert = Omit<ProfileRow, "created_at" | "updated_at">;
export type OrganizationInsert = Omit<OrganizationRow, "id" | "created_at" | "updated_at" | "logo_url"> & {
  id?: string;
  logo_url?: string | null;
};
export type OrganizationMemberInsert = Omit<OrganizationMemberRow, "id" | "created_at"> & {
  id?: string;
};
export type ProjectInsert = Omit<
  ProjectRow,
  | "id"
  | "created_at"
  | "updated_at"
  | "github_repository_id"
  | "github_default_branch"
  | "github_last_commit_sha"
  | "github_is_private"
  | "github_connected_at"
  | "security_score"
  | "last_scan_at"
> & {
  id?: string;
  github_repository_id?: number | null;
  github_default_branch?: string | null;
  github_last_commit_sha?: string | null;
  github_is_private?: boolean | null;
  github_connected_at?: string | null;
  security_score?: number | null;
  last_scan_at?: string | null;
};
export type SubscriptionInsert = Omit<SubscriptionRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
};
export type ScanInsert = Omit<ScanRow, "id" | "created_at" | "updated_at"> & { id?: string };
export type ScanFindingInsert = Omit<ScanFindingRow, "id" | "created_at" | "updated_at"> & { id?: string };

// ─── Update Types ─────────────────────────────────────────────────────────────

export type ProfileUpdate = Partial<Omit<ProfileRow, "id" | "created_at">>;
export type OrganizationUpdate = Partial<Omit<OrganizationRow, "id" | "created_at">>;
export type ProjectUpdate = Partial<Omit<ProjectRow, "id" | "organization_id" | "created_at">>;
export type SubscriptionUpdate = Partial<Omit<SubscriptionRow, "id" | "organization_id" | "created_at">>;
export type ScanUpdate = Partial<
  Omit<
    ScanRow,
    "id" | "organization_id" | "project_id" | "repository_id" | "triggered_by_user_id" | "created_at"
  >
>;

// ─── Joined / Extended Types ──────────────────────────────────────────────────

export type ProjectWithOrg = ProjectRow & {
  organization: OrganizationRow;
};

export type OrganizationWithMembership = OrganizationRow & {
  membership: OrganizationMemberRow;
  member_count: number;
  project_count: number;
};

export type MemberWithProfile = OrganizationMemberRow & {
  profile: ProfileRow;
};

// ─── UI / App Types ───────────────────────────────────────────────────────────

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  isNew?: boolean;
  comingSoon?: boolean;
};

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: string };

export type DashboardStats = {
  totalProjects: number;
  criticalIssues: number;
  securityScore: number | null;
  recentActivity: number;
};

export type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

// ─── Scanner types (reserved for future implementation) ───────────────────────

export type ScanFinding = {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category:
    | "SECRETS"
    | "SQL_INJECTION"
    | "XSS"
    | "CORS"
    | "SUPABASE_RLS"
    | "FIREBASE_RULES"
    | "DEPENDENCIES"
    | "AUTH"
    | "API_SECURITY"
    | "CONFIG";
  title: string;
  description: string;
  impact: string;
  recommendation: string;
  filePath?: string;
  lineNumber?: number;
  codeSnippet?: string;
};

export type ScanResult = {
  findings: ScanFinding[];
  score: number;
  summary: string;
};
