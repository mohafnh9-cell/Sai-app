var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// brain/production-verdict/coverage.ts
var AREA_DEFINITIONS = {
  security: {
    label: "Security",
    defaultStatus: "evaluated",
    methodology: "Static analysis of source files against security rules plus correlated security tests."
  },
  authentication: {
    label: "Authentication",
    defaultStatus: "evaluated",
    methodology: "Auth routes, sessions, tokens, OAuth, password reset, and MFA patterns in code review.",
    limitations: "Live credential flows require authorized staging for full dynamic confirmation."
  },
  authorization: {
    label: "Authorization",
    defaultStatus: "evaluated",
    methodology: "RBAC, ownership checks, tenant isolation, IDOR/BOLA patterns, and admin routes.",
    limitations: "Cross-user attacks run in mock or authorized staging modes only."
  },
  data_protection: {
    label: "Data Protection",
    defaultStatus: "evaluated",
    methodology: "Secrets, credentials, client exposure, and sensitive data handling via static rules.",
    limitations: "Encryption at rest and transit inferred from configuration patterns only."
  },
  dependencies: {
    label: "Dependencies",
    defaultStatus: "evaluated",
    methodology: "Manifest, lockfile, and security-sensitive dependency catalog analysis.",
    limitations: "Live CVE advisory feeds are not queried in this pass."
  },
  architecture: {
    label: "Architecture",
    defaultStatus: "evaluated",
    methodology: "Structural inference from routes, modules, and deployment configuration.",
    limitations: "No runtime topology or load analysis."
  },
  testing: {
    label: "Testing",
    defaultStatus: "not_evaluated",
    methodology: "Detects automated test files and runner configuration in the repository.",
    limitations: "Does not execute tests or measure coverage percentages."
  },
  performance: {
    label: "Performance",
    defaultStatus: "not_evaluated",
    methodology: "Static signals for caching, timing hooks, and framework config.",
    limitations: "No profiling or load testing."
  },
  deployment: {
    label: "Deployment",
    defaultStatus: "evaluated",
    methodology: "CI/CD workflows, deployment configuration, and supply-chain static checks.",
    limitations: "Actual deployment environment not inspected live."
  },
  observability: {
    label: "Observability",
    defaultStatus: "not_evaluated",
    methodology: "Detects metrics, health endpoints, and operational event instrumentation.",
    limitations: "Does not verify external monitoring integrations."
  },
  database: {
    label: "Database",
    defaultStatus: "evaluated",
    methodology: "SQL, RLS assessment, ORM misuse, and database configuration findings.",
    limitations: "Live database policies are inferred from migrations unless staging attacks run."
  },
  reliability: {
    label: "Reliability",
    defaultStatus: "not_evaluated",
    methodology: "Detects background workers, recovery jobs, and idempotency patterns.",
    limitations: "Fault injection and chaos testing are not performed."
  }
};
var CATEGORY_TO_AREAS = {
  secrets: ["security", "data_protection"],
  authentication: ["authentication", "security"],
  authorization: ["authorization", "authentication", "security"],
  injection: ["security", "database"],
  xss: ["security"],
  web: ["security", "deployment"],
  api: ["security", "architecture"],
  cicd: ["deployment", "security"],
  validation: ["security", "architecture"],
  configuration: ["deployment", "security"],
  database: ["database", "security"],
  dependencies: ["dependencies"],
  architecture: ["architecture"],
  testing: ["testing"],
  performance: ["performance"],
  observability: ["observability"],
  reliability: ["reliability"],
  availability: ["security", "authentication"]
};
function areaEvidenceCount(area, findings) {
  return findings.filter((f) => {
    if (f.ruleId === "readiness.area-baseline" || f.ruleId === "security.area-baseline") {
      return false;
    }
    const areas = CATEGORY_TO_AREAS[f.category] ?? ["security"];
    return areas.includes(area);
  }).length;
}
function baselineStatusFromFindings(area, findings) {
  const readiness = findings.find(
    (finding) => finding.ruleId === "readiness.area-baseline" && finding.category === area
  );
  if (readiness) {
    if (readiness.evidence?.includes("level=evaluated")) return "evaluated";
    return "evaluated";
  }
  const securityBaseline = findings.find((finding) => {
    if (finding.ruleId !== "security.area-baseline") return false;
    return finding.evidence?.includes(`area=${area}`);
  });
  if (securityBaseline) return "evaluated";
  return null;
}
function resolveAreaStatus(area, evidenceCount, filesAnalyzed, findings) {
  const baseline = baselineStatusFromFindings(area, findings);
  if (baseline === "evaluated") return "evaluated";
  const def = AREA_DEFINITIONS[area];
  if (def.defaultStatus === "not_evaluated" && evidenceCount === 0 && !baseline) {
    if (filesAnalyzed >= 50) return "evaluated";
    return "not_evaluated";
  }
  if (def.defaultStatus === "evaluated" && filesAnalyzed > 0) {
    return "evaluated";
  }
  if (evidenceCount > 0 || area === "security" && filesAnalyzed > 0) {
    return def.defaultStatus === "not_evaluated" ? "evaluated" : def.defaultStatus;
  }
  if (def.defaultStatus === "evaluated") return "evaluated";
  if (filesAnalyzed > 0 && def.defaultStatus !== "not_evaluated") return "evaluated";
  return "not_evaluated";
}
function penalizingEvidenceCount(area, findings) {
  return findings.filter((f) => {
    const areas = CATEGORY_TO_AREAS[f.category] ?? ["security"];
    if (!areas.includes(area)) return false;
    if (f.ruleId === "readiness.area-baseline" || f.ruleId === "security.area-baseline") return false;
    return f.severity !== "info";
  }).length;
}
function areaScore(area, status, securityScore, findings) {
  if (status === "not_evaluated") return null;
  if (securityScore === null) return null;
  if (area === "security") return securityScore;
  const penalty = Math.min(40, penalizingEvidenceCount(area, findings) * 8);
  return Math.max(0, Math.min(100, securityScore - penalty));
}
function assessCoverage(input) {
  const { findings, securityScore, filesAnalyzed } = input;
  const allAreas = Object.keys(AREA_DEFINITIONS);
  const assessments = allAreas.map((key) => {
    const def = AREA_DEFINITIONS[key];
    const evidenceCount = areaEvidenceCount(key, findings);
    const status = resolveAreaStatus(key, evidenceCount, filesAnalyzed, findings);
    const score = areaScore(key, status, securityScore, findings);
    let confidence = "low";
    if (status === "evaluated") {
      confidence = evidenceCount > 0 ? "high" : "medium";
    }
    return {
      key,
      label: def.label,
      status,
      score,
      confidence,
      evidenceCount,
      methodology: def.methodology,
      limitations: def.limitations
    };
  });
  const evaluatedAreas = assessments.filter((a) => a.status === "evaluated");
  const partiallyEvaluatedAreas = assessments.filter((a) => a.status === "partial");
  const unevaluatedAreas = assessments.filter((a) => a.status === "not_evaluated");
  const coverageRatio = filesAnalyzed > 0 ? Math.min(
    1,
    Math.max(
      filesAnalyzed >= 10 ? 0.2 : 0,
      findings.length > 0 ? 0.4 + Math.min(0.6, filesAnalyzed / 200) : filesAnalyzed / 100
    )
  ) : null;
  return {
    evaluatedAreas,
    partiallyEvaluatedAreas,
    unevaluatedAreas,
    coverageRatio
  };
}
function hasSufficientCoverage(input) {
  if (input.scanStatus === "failed") return false;
  if (input.filesAnalyzed < 3) return false;
  if (input.filesAnalyzed >= 3) return true;
  if (input.coverageRatio != null && input.coverageRatio < 0.15) return false;
  return true;
}

// brain/production-verdict/fix-time.ts
function estimateFixTime(input) {
  const fileCount = input.affectedFiles.length || 1;
  const findingCount = input.findingIds.length || 1;
  if (input.severity === "critical" && input.category === "data_protection") {
    return { minutes: 4, label: "2\u20135 min" };
  }
  if (input.category === "authorization" && fileCount >= 3) {
    return { minutes: 20, label: "10\u201320 min" };
  }
  if (input.category === "authentication") {
    return findingCount > 2 ? { minutes: 30, label: "30\u201360 min" } : { minutes: 15, label: "10\u201320 min" };
  }
  if (input.category === "deployment") {
    return { minutes: 8, label: "5\u201310 min" };
  }
  if (input.severity === "critical") {
    return { minutes: 10, label: "10\u201320 min" };
  }
  if (input.severity === "high") {
    return fileCount > 2 ? { minutes: 15, label: "10\u201320 min" } : { minutes: 5, label: "2\u20135 min" };
  }
  if (input.requiresMigration) {
    return { minutes: 45, label: "Requires manual review" };
  }
  return { minutes: 5, label: "2\u20135 min" };
}
function applyFixTimeEstimates(priorities) {
  return priorities.map((priority) => {
    const { minutes, label } = estimateFixTime(priority);
    return {
      ...priority,
      estimatedMinutes: minutes,
      estimatedTimeLabel: label
    };
  });
}
function totalEstimatedMinutes(priorities) {
  return priorities.reduce((sum, p2) => sum + p2.estimatedMinutes, 0);
}

// node_modules/zod/v4/classic/external.js
var external_exports = {};
__export(external_exports, {
  $brand: () => $brand,
  $input: () => $input,
  $output: () => $output,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRealError: () => ZodRealError,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default2,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch2,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  clone: () => clone,
  codec: () => codec,
  coerce: () => coerce_exports,
  config: () => config,
  core: () => core_exports2,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  custom: () => custom,
  date: () => date3,
  decode: () => decode2,
  decodeAsync: () => decodeAsync2,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  encode: () => encode2,
  encodeAsync: () => encodeAsync2,
  endsWith: () => _endsWith,
  enum: () => _enum2,
  exactOptional: () => exactOptional,
  file: () => file,
  flattenError: () => flattenError,
  float32: () => float32,
  float64: () => float64,
  formatError: () => formatError,
  fromJSONSchema: () => fromJSONSchema,
  function: () => _function,
  getErrorMap: () => getErrorMap,
  globalRegistry: () => globalRegistry,
  gt: () => _gt,
  gte: () => _gte,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  includes: () => _includes,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  iso: () => iso_exports,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  length: () => _length,
  literal: () => literal,
  locales: () => locales_exports,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  mac: () => mac2,
  map: () => map,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  meta: () => meta2,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  negative: () => _negative,
  never: () => never,
  nonnegative: () => _nonnegative,
  nonoptional: () => nonoptional,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  overwrite: () => _overwrite,
  parse: () => parse2,
  parseAsync: () => parseAsync2,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  positive: () => _positive,
  prefault: () => prefault,
  preprocess: () => preprocess,
  prettifyError: () => prettifyError,
  promise: () => promise,
  property: () => _property,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  regex: () => _regex,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode2,
  safeDecodeAsync: () => safeDecodeAsync2,
  safeEncode: () => safeEncode2,
  safeEncodeAsync: () => safeEncodeAsync2,
  safeParse: () => safeParse2,
  safeParseAsync: () => safeParseAsync2,
  set: () => set,
  setErrorMap: () => setErrorMap,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  toJSONSchema: () => toJSONSchema,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  transform: () => transform,
  treeifyError: () => treeifyError,
  trim: () => _trim,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  uppercase: () => _uppercase,
  url: () => url,
  util: () => util_exports,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  void: () => _void2,
  xid: () => xid2,
  xor: () => xor
});

// node_modules/zod/v4/core/index.js
var core_exports2 = {};
__export(core_exports2, {
  $ZodAny: () => $ZodAny,
  $ZodArray: () => $ZodArray,
  $ZodAsyncError: () => $ZodAsyncError,
  $ZodBase64: () => $ZodBase64,
  $ZodBase64URL: () => $ZodBase64URL,
  $ZodBigInt: () => $ZodBigInt,
  $ZodBigIntFormat: () => $ZodBigIntFormat,
  $ZodBoolean: () => $ZodBoolean,
  $ZodCIDRv4: () => $ZodCIDRv4,
  $ZodCIDRv6: () => $ZodCIDRv6,
  $ZodCUID: () => $ZodCUID,
  $ZodCUID2: () => $ZodCUID2,
  $ZodCatch: () => $ZodCatch,
  $ZodCheck: () => $ZodCheck,
  $ZodCheckBigIntFormat: () => $ZodCheckBigIntFormat,
  $ZodCheckEndsWith: () => $ZodCheckEndsWith,
  $ZodCheckGreaterThan: () => $ZodCheckGreaterThan,
  $ZodCheckIncludes: () => $ZodCheckIncludes,
  $ZodCheckLengthEquals: () => $ZodCheckLengthEquals,
  $ZodCheckLessThan: () => $ZodCheckLessThan,
  $ZodCheckLowerCase: () => $ZodCheckLowerCase,
  $ZodCheckMaxLength: () => $ZodCheckMaxLength,
  $ZodCheckMaxSize: () => $ZodCheckMaxSize,
  $ZodCheckMimeType: () => $ZodCheckMimeType,
  $ZodCheckMinLength: () => $ZodCheckMinLength,
  $ZodCheckMinSize: () => $ZodCheckMinSize,
  $ZodCheckMultipleOf: () => $ZodCheckMultipleOf,
  $ZodCheckNumberFormat: () => $ZodCheckNumberFormat,
  $ZodCheckOverwrite: () => $ZodCheckOverwrite,
  $ZodCheckProperty: () => $ZodCheckProperty,
  $ZodCheckRegex: () => $ZodCheckRegex,
  $ZodCheckSizeEquals: () => $ZodCheckSizeEquals,
  $ZodCheckStartsWith: () => $ZodCheckStartsWith,
  $ZodCheckStringFormat: () => $ZodCheckStringFormat,
  $ZodCheckUpperCase: () => $ZodCheckUpperCase,
  $ZodCodec: () => $ZodCodec,
  $ZodCustom: () => $ZodCustom,
  $ZodCustomStringFormat: () => $ZodCustomStringFormat,
  $ZodDate: () => $ZodDate,
  $ZodDefault: () => $ZodDefault,
  $ZodDiscriminatedUnion: () => $ZodDiscriminatedUnion,
  $ZodE164: () => $ZodE164,
  $ZodEmail: () => $ZodEmail,
  $ZodEmoji: () => $ZodEmoji,
  $ZodEncodeError: () => $ZodEncodeError,
  $ZodEnum: () => $ZodEnum,
  $ZodError: () => $ZodError,
  $ZodExactOptional: () => $ZodExactOptional,
  $ZodFile: () => $ZodFile,
  $ZodFunction: () => $ZodFunction,
  $ZodGUID: () => $ZodGUID,
  $ZodIPv4: () => $ZodIPv4,
  $ZodIPv6: () => $ZodIPv6,
  $ZodISODate: () => $ZodISODate,
  $ZodISODateTime: () => $ZodISODateTime,
  $ZodISODuration: () => $ZodISODuration,
  $ZodISOTime: () => $ZodISOTime,
  $ZodIntersection: () => $ZodIntersection,
  $ZodJWT: () => $ZodJWT,
  $ZodKSUID: () => $ZodKSUID,
  $ZodLazy: () => $ZodLazy,
  $ZodLiteral: () => $ZodLiteral,
  $ZodMAC: () => $ZodMAC,
  $ZodMap: () => $ZodMap,
  $ZodNaN: () => $ZodNaN,
  $ZodNanoID: () => $ZodNanoID,
  $ZodNever: () => $ZodNever,
  $ZodNonOptional: () => $ZodNonOptional,
  $ZodNull: () => $ZodNull,
  $ZodNullable: () => $ZodNullable,
  $ZodNumber: () => $ZodNumber,
  $ZodNumberFormat: () => $ZodNumberFormat,
  $ZodObject: () => $ZodObject,
  $ZodObjectJIT: () => $ZodObjectJIT,
  $ZodOptional: () => $ZodOptional,
  $ZodPipe: () => $ZodPipe,
  $ZodPrefault: () => $ZodPrefault,
  $ZodPreprocess: () => $ZodPreprocess,
  $ZodPromise: () => $ZodPromise,
  $ZodReadonly: () => $ZodReadonly,
  $ZodRealError: () => $ZodRealError,
  $ZodRecord: () => $ZodRecord,
  $ZodRegistry: () => $ZodRegistry,
  $ZodSet: () => $ZodSet,
  $ZodString: () => $ZodString,
  $ZodStringFormat: () => $ZodStringFormat,
  $ZodSuccess: () => $ZodSuccess,
  $ZodSymbol: () => $ZodSymbol,
  $ZodTemplateLiteral: () => $ZodTemplateLiteral,
  $ZodTransform: () => $ZodTransform,
  $ZodTuple: () => $ZodTuple,
  $ZodType: () => $ZodType,
  $ZodULID: () => $ZodULID,
  $ZodURL: () => $ZodURL,
  $ZodUUID: () => $ZodUUID,
  $ZodUndefined: () => $ZodUndefined,
  $ZodUnion: () => $ZodUnion,
  $ZodUnknown: () => $ZodUnknown,
  $ZodVoid: () => $ZodVoid,
  $ZodXID: () => $ZodXID,
  $ZodXor: () => $ZodXor,
  $brand: () => $brand,
  $constructor: () => $constructor,
  $input: () => $input,
  $output: () => $output,
  Doc: () => Doc,
  JSONSchema: () => json_schema_exports,
  JSONSchemaGenerator: () => JSONSchemaGenerator,
  NEVER: () => NEVER,
  TimePrecision: () => TimePrecision,
  _any: () => _any,
  _array: () => _array,
  _base64: () => _base64,
  _base64url: () => _base64url,
  _bigint: () => _bigint,
  _boolean: () => _boolean,
  _catch: () => _catch,
  _check: () => _check,
  _cidrv4: () => _cidrv4,
  _cidrv6: () => _cidrv6,
  _coercedBigint: () => _coercedBigint,
  _coercedBoolean: () => _coercedBoolean,
  _coercedDate: () => _coercedDate,
  _coercedNumber: () => _coercedNumber,
  _coercedString: () => _coercedString,
  _cuid: () => _cuid,
  _cuid2: () => _cuid2,
  _custom: () => _custom,
  _date: () => _date,
  _decode: () => _decode,
  _decodeAsync: () => _decodeAsync,
  _default: () => _default,
  _discriminatedUnion: () => _discriminatedUnion,
  _e164: () => _e164,
  _email: () => _email,
  _emoji: () => _emoji2,
  _encode: () => _encode,
  _encodeAsync: () => _encodeAsync,
  _endsWith: () => _endsWith,
  _enum: () => _enum,
  _file: () => _file,
  _float32: () => _float32,
  _float64: () => _float64,
  _gt: () => _gt,
  _gte: () => _gte,
  _guid: () => _guid,
  _includes: () => _includes,
  _int: () => _int,
  _int32: () => _int32,
  _int64: () => _int64,
  _intersection: () => _intersection,
  _ipv4: () => _ipv4,
  _ipv6: () => _ipv6,
  _isoDate: () => _isoDate,
  _isoDateTime: () => _isoDateTime,
  _isoDuration: () => _isoDuration,
  _isoTime: () => _isoTime,
  _jwt: () => _jwt,
  _ksuid: () => _ksuid,
  _lazy: () => _lazy,
  _length: () => _length,
  _literal: () => _literal,
  _lowercase: () => _lowercase,
  _lt: () => _lt,
  _lte: () => _lte,
  _mac: () => _mac,
  _map: () => _map,
  _max: () => _lte,
  _maxLength: () => _maxLength,
  _maxSize: () => _maxSize,
  _mime: () => _mime,
  _min: () => _gte,
  _minLength: () => _minLength,
  _minSize: () => _minSize,
  _multipleOf: () => _multipleOf,
  _nan: () => _nan,
  _nanoid: () => _nanoid,
  _nativeEnum: () => _nativeEnum,
  _negative: () => _negative,
  _never: () => _never,
  _nonnegative: () => _nonnegative,
  _nonoptional: () => _nonoptional,
  _nonpositive: () => _nonpositive,
  _normalize: () => _normalize,
  _null: () => _null2,
  _nullable: () => _nullable,
  _number: () => _number,
  _optional: () => _optional,
  _overwrite: () => _overwrite,
  _parse: () => _parse,
  _parseAsync: () => _parseAsync,
  _pipe: () => _pipe,
  _positive: () => _positive,
  _promise: () => _promise,
  _property: () => _property,
  _readonly: () => _readonly,
  _record: () => _record,
  _refine: () => _refine,
  _regex: () => _regex,
  _safeDecode: () => _safeDecode,
  _safeDecodeAsync: () => _safeDecodeAsync,
  _safeEncode: () => _safeEncode,
  _safeEncodeAsync: () => _safeEncodeAsync,
  _safeParse: () => _safeParse,
  _safeParseAsync: () => _safeParseAsync,
  _set: () => _set,
  _size: () => _size,
  _slugify: () => _slugify,
  _startsWith: () => _startsWith,
  _string: () => _string,
  _stringFormat: () => _stringFormat,
  _stringbool: () => _stringbool,
  _success: () => _success,
  _superRefine: () => _superRefine,
  _symbol: () => _symbol,
  _templateLiteral: () => _templateLiteral,
  _toLowerCase: () => _toLowerCase,
  _toUpperCase: () => _toUpperCase,
  _transform: () => _transform,
  _trim: () => _trim,
  _tuple: () => _tuple,
  _uint32: () => _uint32,
  _uint64: () => _uint64,
  _ulid: () => _ulid,
  _undefined: () => _undefined2,
  _union: () => _union,
  _unknown: () => _unknown,
  _uppercase: () => _uppercase,
  _url: () => _url,
  _uuid: () => _uuid,
  _uuidv4: () => _uuidv4,
  _uuidv6: () => _uuidv6,
  _uuidv7: () => _uuidv7,
  _void: () => _void,
  _xid: () => _xid,
  _xor: () => _xor,
  clone: () => clone,
  config: () => config,
  createStandardJSONSchemaMethod: () => createStandardJSONSchemaMethod,
  createToJSONSchemaMethod: () => createToJSONSchemaMethod,
  decode: () => decode,
  decodeAsync: () => decodeAsync,
  describe: () => describe,
  encode: () => encode,
  encodeAsync: () => encodeAsync,
  extractDefs: () => extractDefs,
  finalize: () => finalize,
  flattenError: () => flattenError,
  formatError: () => formatError,
  globalConfig: () => globalConfig,
  globalRegistry: () => globalRegistry,
  initializeContext: () => initializeContext,
  isValidBase64: () => isValidBase64,
  isValidBase64URL: () => isValidBase64URL,
  isValidJWT: () => isValidJWT,
  locales: () => locales_exports,
  meta: () => meta,
  parse: () => parse,
  parseAsync: () => parseAsync,
  prettifyError: () => prettifyError,
  process: () => process2,
  regexes: () => regexes_exports,
  registry: () => registry,
  safeDecode: () => safeDecode,
  safeDecodeAsync: () => safeDecodeAsync,
  safeEncode: () => safeEncode,
  safeEncodeAsync: () => safeEncodeAsync,
  safeParse: () => safeParse,
  safeParseAsync: () => safeParseAsync,
  toDotPath: () => toDotPath,
  toJSONSchema: () => toJSONSchema,
  treeifyError: () => treeifyError,
  util: () => util_exports,
  version: () => version
});

// node_modules/zod/v4/core/core.js
var _a;
var NEVER = /* @__PURE__ */ Object.freeze({
  status: "aborted"
});
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: /* @__PURE__ */ new Set()
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a3;
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set2 = false;
  return {
    get value() {
      if (!set2) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class2 ? new Class2({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class2, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class2({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base643) {
  const binaryString = atob(base643);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url3) {
  const base643 = base64url3.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base643.length % 4) % 4);
  return base64ToUint8Array(base643 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex3) {
  const cleanHex = hex3.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};

// node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error51, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error51.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error51, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error52, path = []) => {
    for (const issue2 of error52.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error51);
  return fieldErrors;
}
function treeifyError(error51, mapper = (issue2) => issue2.message) {
  const result = { errors: [] };
  const processError = (error52, path = []) => {
    var _a3, _b;
    for (const issue2 of error52.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          result.errors.push(mapper(issue2));
          continue;
        }
        let curr = result;
        let i = 0;
        while (i < fullpath.length) {
          const el = fullpath[i];
          const terminal = i === fullpath.length - 1;
          if (typeof el === "string") {
            curr.properties ?? (curr.properties = {});
            (_a3 = curr.properties)[el] ?? (_a3[el] = { errors: [] });
            curr = curr.properties[el];
          } else {
            curr.items ?? (curr.items = []);
            (_b = curr.items)[el] ?? (_b[el] = { errors: [] });
            curr = curr.items[el];
          }
          if (terminal) {
            curr.errors.push(mapper(issue2));
          }
          i++;
        }
      }
    }
  };
  processError(error51);
  return result;
}
function toDotPath(_path) {
  const segs = [];
  const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
  for (const seg of path) {
    if (typeof seg === "number")
      segs.push(`[${seg}]`);
    else if (typeof seg === "symbol")
      segs.push(`[${JSON.stringify(String(seg))}]`);
    else if (/[^\w$]/.test(seg))
      segs.push(`[${JSON.stringify(seg)}]`);
    else {
      if (segs.length)
        segs.push(".");
      segs.push(seg);
    }
  }
  return segs.join("");
}
function prettifyError(error51) {
  const lines = [];
  const issues = [...error51.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
  for (const issue2 of issues) {
    lines.push(`\u2716 ${issue2.message}`);
    if (issue2.path?.length)
      lines.push(`  \u2192 at ${toDotPath(issue2.path)}`);
  }
  return lines.join("\n");
}

// node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var parse = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var encode = /* @__PURE__ */ _encode($ZodRealError);
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var decode = /* @__PURE__ */ _decode($ZodRealError);
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var encodeAsync = /* @__PURE__ */ _encodeAsync($ZodRealError);
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var decodeAsync = /* @__PURE__ */ _decodeAsync($ZodRealError);
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var safeEncode = /* @__PURE__ */ _safeEncode($ZodRealError);
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var safeDecode = /* @__PURE__ */ _safeDecode($ZodRealError);
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync($ZodRealError);
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync($ZodRealError);

// node_modules/zod/v4/core/regexes.js
var regexes_exports = {};
__export(regexes_exports, {
  base64: () => base64,
  base64url: () => base64url,
  bigint: () => bigint,
  boolean: () => boolean,
  browserEmail: () => browserEmail,
  cidrv4: () => cidrv4,
  cidrv6: () => cidrv6,
  cuid: () => cuid,
  cuid2: () => cuid2,
  date: () => date,
  datetime: () => datetime,
  domain: () => domain,
  duration: () => duration,
  e164: () => e164,
  email: () => email,
  emoji: () => emoji,
  extendedDuration: () => extendedDuration,
  guid: () => guid,
  hex: () => hex,
  hostname: () => hostname,
  html5Email: () => html5Email,
  httpProtocol: () => httpProtocol,
  idnEmail: () => idnEmail,
  integer: () => integer,
  ipv4: () => ipv4,
  ipv6: () => ipv6,
  ksuid: () => ksuid,
  lowercase: () => lowercase,
  mac: () => mac,
  md5_base64: () => md5_base64,
  md5_base64url: () => md5_base64url,
  md5_hex: () => md5_hex,
  nanoid: () => nanoid,
  null: () => _null,
  number: () => number,
  rfc5322Email: () => rfc5322Email,
  sha1_base64: () => sha1_base64,
  sha1_base64url: () => sha1_base64url,
  sha1_hex: () => sha1_hex,
  sha256_base64: () => sha256_base64,
  sha256_base64url: () => sha256_base64url,
  sha256_hex: () => sha256_hex,
  sha384_base64: () => sha384_base64,
  sha384_base64url: () => sha384_base64url,
  sha384_hex: () => sha384_hex,
  sha512_base64: () => sha512_base64,
  sha512_base64url: () => sha512_base64url,
  sha512_hex: () => sha512_hex,
  string: () => string,
  time: () => time,
  ulid: () => ulid,
  undefined: () => _undefined,
  unicodeEmail: () => unicodeEmail,
  uppercase: () => uppercase,
  uuid: () => uuid,
  uuid4: () => uuid4,
  uuid6: () => uuid6,
  uuid7: () => uuid7,
  xid: () => xid
});
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var uuid4 = /* @__PURE__ */ uuid(4);
var uuid6 = /* @__PURE__ */ uuid(6);
var uuid7 = /* @__PURE__ */ uuid(7);
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var rfc5322Email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
var unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
var idnEmail = unicodeEmail;
var browserEmail = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var mac = (delimiter) => {
  const escapedDelim = escapeRegex(delimiter ?? ":");
  return new RegExp(`^(?:[0-9A-F]{2}${escapedDelim}){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}${escapedDelim}){5}[0-9a-f]{2}$`);
};
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
var domain = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time3 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time3}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var bigint = /^-?\d+n?$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var _null = /^null$/i;
var _undefined = /^undefined$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
var hex = /^[0-9a-fA-F]*$/;
function fixedBase64(bodyLength, padding) {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}
function fixedBase64url(length) {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}
var md5_hex = /^[0-9a-fA-F]{32}$/;
var md5_base64 = /* @__PURE__ */ fixedBase64(22, "==");
var md5_base64url = /* @__PURE__ */ fixedBase64url(22);
var sha1_hex = /^[0-9a-fA-F]{40}$/;
var sha1_base64 = /* @__PURE__ */ fixedBase64(27, "=");
var sha1_base64url = /* @__PURE__ */ fixedBase64url(27);
var sha256_hex = /^[0-9a-fA-F]{64}$/;
var sha256_base64 = /* @__PURE__ */ fixedBase64(43, "=");
var sha256_base64url = /* @__PURE__ */ fixedBase64url(43);
var sha384_hex = /^[0-9a-fA-F]{96}$/;
var sha384_base64 = /* @__PURE__ */ fixedBase64(64, "");
var sha384_base64url = /* @__PURE__ */ fixedBase64url(64);
var sha512_hex = /^[0-9a-fA-F]{128}$/;
var sha512_base64 = /* @__PURE__ */ fixedBase64(86, "==");
var sha512_base64url = /* @__PURE__ */ fixedBase64url(86);

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a3;
    (_a3 = inst2._zod.bag).multipleOf ?? (_a3.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckBigIntFormat = /* @__PURE__ */ $constructor("$ZodCheckBigIntFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  const [minimum, maximum] = BIGINT_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (input < minimum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxSize = /* @__PURE__ */ $constructor("$ZodCheckMaxSize", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size <= def.maximum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinSize = /* @__PURE__ */ $constructor("$ZodCheckMinSize", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size >= def.minimum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckSizeEquals = /* @__PURE__ */ $constructor("$ZodCheckSizeEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.size;
    bag.maximum = def.size;
    bag.size = def.size;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size === def.size)
      return;
    const tooBig = size > def.size;
    payload.issues.push({
      origin: getSizableOrigin(input),
      ...tooBig ? { code: "too_big", maximum: def.size } : { code: "too_small", minimum: def.size },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function handleCheckPropertyResult(result, payload, property) {
  if (result.issues.length) {
    payload.issues.push(...prefixIssues(property, result.issues));
  }
}
var $ZodCheckProperty = /* @__PURE__ */ $constructor("$ZodCheckProperty", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    const result = def.schema._zod.run({
      value: payload.value[def.property],
      issues: []
    }, {});
    if (result instanceof Promise) {
      return result.then((result2) => handleCheckPropertyResult(result2, payload, def.property));
    }
    handleCheckPropertyResult(result, payload, def.property);
    return;
  };
});
var $ZodCheckMimeType = /* @__PURE__ */ $constructor("$ZodCheckMimeType", (inst, def) => {
  $ZodCheck.init(inst, def);
  const mimeSet = new Set(def.mime);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.mime = def.mime;
  });
  inst._zod.check = (payload) => {
    if (mimeSet.has(payload.value.type))
      return;
    payload.issues.push({
      code: "invalid_value",
      values: def.mime,
      input: payload.value.type,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
};

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url2 = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url2.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url2.protocol.endsWith(":") ? url2.protocol.slice(0, -1) : url2.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url2.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodMAC = /* @__PURE__ */ $constructor("$ZodMAC", (inst, def) => {
  def.pattern ?? (def.pattern = mac(def.delimiter));
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `mac`;
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error();
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error();
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error();
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error();
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base643 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base643.padEnd(Math.ceil(base643.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCustomStringFormat = /* @__PURE__ */ $constructor("$ZodCustomStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (def.fn(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: def.format,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodBigInt = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = bigint;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = BigInt(payload.value);
      } catch (_) {
      }
    if (typeof payload.value === "bigint")
      return payload;
    payload.issues.push({
      expected: "bigint",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodBigIntFormat = /* @__PURE__ */ $constructor("$ZodBigIntFormat", (inst, def) => {
  $ZodCheckBigIntFormat.init(inst, def);
  $ZodBigInt.init(inst, def);
});
var $ZodSymbol = /* @__PURE__ */ $constructor("$ZodSymbol", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "symbol")
      return payload;
    payload.issues.push({
      expected: "symbol",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUndefined = /* @__PURE__ */ $constructor("$ZodUndefined", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _undefined;
  inst._zod.values = /* @__PURE__ */ new Set([void 0]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "undefined",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = /* @__PURE__ */ new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodAny = /* @__PURE__ */ $constructor("$ZodAny", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodVoid = /* @__PURE__ */ $constructor("$ZodVoid", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "void",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodDate = /* @__PURE__ */ $constructor("$ZodDate", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce) {
      try {
        payload.value = new Date(payload.value);
      } catch (_err) {
      }
    }
    const input = payload.value;
    const isDate = input instanceof Date;
    const isValidDate = isDate && !Number.isNaN(input.getTime());
    if (isValidDate)
      return payload;
    payload.issues.push({
      expected: "date",
      code: "invalid_type",
      input,
      ...isDate ? { received: "Invalid Date" } : {},
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p2) => cleanRegex(p2.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
function handleExclusiveUnionResults(results, final, inst, ctx) {
  const successes = results.filter((r) => r.issues.length === 0);
  if (successes.length === 1) {
    final.value = successes[0].value;
    return final;
  }
  if (successes.length === 0) {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
    });
  } else {
    final.issues.push({
      code: "invalid_union",
      input: final.value,
      inst,
      errors: [],
      inclusive: false
    });
  }
  return final;
}
var $ZodXor = /* @__PURE__ */ $constructor("$ZodXor", (inst, def) => {
  $ZodUnion.init(inst, def);
  def.inclusive = false;
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        results.push(result);
      }
    }
    if (!async)
      return handleExclusiveUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleExclusiveUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazy(inst._zod, "propValues", () => {
    const propValues = {};
    for (const option of def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
      for (const [k, v] of Object.entries(pv)) {
        if (!propValues[k])
          propValues[k] = /* @__PURE__ */ new Set();
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    return propValues;
  });
  const disc = cached(() => {
    const opts = def.options;
    const map2 = /* @__PURE__ */ new Map();
    for (const o of opts) {
      const values = o._zod.propValues?.[def.discriminator];
      if (!values || values.size === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
      for (const v of values) {
        if (map2.has(v)) {
          throw new Error(`Duplicate discriminator value "${String(v)}"`);
        }
        map2.set(v, o);
      }
    }
    return map2;
  });
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const opt = disc.value.get(input?.[def.discriminator]);
    if (opt) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodTuple = /* @__PURE__ */ $constructor("$ZodTuple", (inst, def) => {
  $ZodType.init(inst, def);
  const items = def.items;
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        input,
        inst,
        expected: "tuple",
        code: "invalid_type"
      });
      return payload;
    }
    payload.value = [];
    const proms = [];
    const optinStart = getTupleOptStart(items, "optin");
    const optoutStart = getTupleOptStart(items, "optout");
    if (!def.rest) {
      if (input.length < optinStart) {
        payload.issues.push({
          code: "too_small",
          minimum: optinStart,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
        return payload;
      }
      if (input.length > items.length) {
        payload.issues.push({
          code: "too_big",
          maximum: items.length,
          inclusive: true,
          input,
          inst,
          origin: "array"
        });
      }
    }
    const itemResults = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const r = items[i]._zod.run({ value: input[i], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((rr) => {
          itemResults[i] = rr;
        }));
      } else {
        itemResults[i] = r;
      }
    }
    if (def.rest) {
      let i = items.length - 1;
      const rest = input.slice(items.length);
      for (const el of rest) {
        i++;
        const result = def.rest._zod.run({ value: el, issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((r) => handleTupleResult(r, payload, i)));
        } else {
          handleTupleResult(result, payload, i);
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input, optoutStart));
    }
    return handleTupleResults(itemResults, payload, items, input, optoutStart);
  };
});
function getTupleOptStart(items, key) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]._zod[key] !== "optional")
      return i + 1;
  }
  return 0;
}
function handleTupleResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input, optoutStart) {
  for (let i = 0; i < items.length; i++) {
    const r = itemResults[i];
    const isPresent = i < input.length;
    if (r.issues.length) {
      if (!isPresent && i >= optoutStart) {
        final.value.length = i;
        break;
      }
      final.issues.push(...prefixIssues(i, r.issues));
    }
    final.value[i] = r.value;
  }
  for (let i = final.value.length - 1; i >= input.length; i--) {
    if (items[i]._zod.optout === "optional" && final.value[i] === void 0) {
      final.value.length = i;
    } else {
      break;
    }
  }
  return final;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values) {
      payload.value = {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[keyResult.value] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodMap = /* @__PURE__ */ $constructor("$ZodMap", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Map)) {
      payload.issues.push({
        expected: "map",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    payload.value = /* @__PURE__ */ new Map();
    for (const [key, value] of input) {
      const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
      const valueResult = def.valueType._zod.run({ value, issues: [] }, ctx);
      if (keyResult instanceof Promise || valueResult instanceof Promise) {
        proms.push(Promise.all([keyResult, valueResult]).then(([keyResult2, valueResult2]) => {
          handleMapResult(keyResult2, valueResult2, payload, key, input, inst, ctx);
        }));
      } else {
        handleMapResult(keyResult, valueResult, payload, key, input, inst, ctx);
      }
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleMapResult(keyResult, valueResult, final, key, input, inst, ctx) {
  if (keyResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, keyResult.issues));
    } else {
      final.issues.push({
        code: "invalid_key",
        origin: "map",
        input,
        inst,
        issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  if (valueResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, valueResult.issues));
    } else {
      final.issues.push({
        origin: "map",
        code: "invalid_element",
        input,
        inst,
        key,
        issues: valueResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  final.value.set(keyResult.value, valueResult.value);
}
var $ZodSet = /* @__PURE__ */ $constructor("$ZodSet", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Set)) {
      payload.issues.push({
        input,
        inst,
        expected: "set",
        code: "invalid_type"
      });
      return payload;
    }
    const proms = [];
    payload.value = /* @__PURE__ */ new Set();
    for (const item of input) {
      const result = def.valueType._zod.run({ value: item, issues: [] }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleSetResult(result2, payload)));
      } else
        handleSetResult(result, payload);
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleSetResult(result, final) {
  if (result.issues.length) {
    final.issues.push(...result.issues);
  }
  final.value.add(result.value);
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodFile = /* @__PURE__ */ $constructor("$ZodFile", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input instanceof File)
      return payload;
    payload.issues.push({
      expected: "file",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === void 0 && (result.issues.length || result.fallback)) {
    return { issues: [], value: void 0 };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === void 0) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodSuccess = /* @__PURE__ */ $constructor("$ZodSuccess", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError("ZodSuccess");
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.issues.length === 0;
        return payload;
      });
    }
    payload.value = result.issues.length === 0;
    return payload;
  };
});
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodNaN = /* @__PURE__ */ $constructor("$ZodNaN", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "number" || !Number.isNaN(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "nan",
        code: "invalid_type"
      });
      return payload;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
var $ZodCodec = /* @__PURE__ */ $constructor("$ZodCodec", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    const direction = ctx.direction || "forward";
    if (direction === "forward") {
      const left = def.in._zod.run(payload, ctx);
      if (left instanceof Promise) {
        return left.then((left2) => handleCodecAResult(left2, def, ctx));
      }
      return handleCodecAResult(left, def, ctx);
    } else {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handleCodecAResult(right2, def, ctx));
      }
      return handleCodecAResult(right, def, ctx);
    }
  };
});
function handleCodecAResult(result, def, ctx) {
  if (result.issues.length) {
    result.aborted = true;
    return result;
  }
  const direction = ctx.direction || "forward";
  if (direction === "forward") {
    const transformed = def.transform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.out, ctx));
    }
    return handleCodecTxResult(result, transformed, def.out, ctx);
  } else {
    const transformed = def.reverseTransform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.in, ctx));
    }
    return handleCodecTxResult(result, transformed, def.in, ctx);
  }
}
function handleCodecTxResult(left, value, nextSchema, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return nextSchema._zod.run({ value, issues: left.issues }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodTemplateLiteral = /* @__PURE__ */ $constructor("$ZodTemplateLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const regexParts = [];
  for (const part of def.parts) {
    if (typeof part === "object" && part !== null) {
      if (!part._zod.pattern) {
        throw new Error(`Invalid template literal part, no pattern found: ${[...part._zod.traits].shift()}`);
      }
      const source = part._zod.pattern instanceof RegExp ? part._zod.pattern.source : part._zod.pattern;
      if (!source)
        throw new Error(`Invalid template literal part: ${part._zod.traits}`);
      const start = source.startsWith("^") ? 1 : 0;
      const end = source.endsWith("$") ? source.length - 1 : source.length;
      regexParts.push(source.slice(start, end));
    } else if (part === null || primitiveTypes.has(typeof part)) {
      regexParts.push(escapeRegex(`${part}`));
    } else {
      throw new Error(`Invalid template literal part: ${part}`);
    }
  }
  inst._zod.pattern = new RegExp(`^${regexParts.join("")}$`);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "string") {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "string",
        code: "invalid_type"
      });
      return payload;
    }
    inst._zod.pattern.lastIndex = 0;
    if (!inst._zod.pattern.test(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        code: "invalid_format",
        format: def.format ?? "template_literal",
        pattern: inst._zod.pattern.source
      });
      return payload;
    }
    return payload;
  };
});
var $ZodFunction = /* @__PURE__ */ $constructor("$ZodFunction", (inst, def) => {
  $ZodType.init(inst, def);
  inst._def = def;
  inst._zod.def = def;
  inst.implement = (func) => {
    if (typeof func !== "function") {
      throw new Error("implement() must be called with a function");
    }
    return function(...args) {
      const parsedArgs = inst._def.input ? parse(inst._def.input, args) : args;
      const result = Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return parse(inst._def.output, result);
      }
      return result;
    };
  };
  inst.implementAsync = (func) => {
    if (typeof func !== "function") {
      throw new Error("implementAsync() must be called with a function");
    }
    return async function(...args) {
      const parsedArgs = inst._def.input ? await parseAsync(inst._def.input, args) : args;
      const result = await Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return await parseAsync(inst._def.output, result);
      }
      return result;
    };
  };
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "function") {
      payload.issues.push({
        code: "invalid_type",
        expected: "function",
        input: payload.value,
        inst
      });
      return payload;
    }
    const hasPromiseOutput = inst._def.output && inst._def.output._zod.def.type === "promise";
    if (hasPromiseOutput) {
      payload.value = inst.implementAsync(payload.value);
    } else {
      payload.value = inst.implement(payload.value);
    }
    return payload;
  };
  inst.input = (...args) => {
    const F = inst.constructor;
    if (Array.isArray(args[0])) {
      return new F({
        type: "function",
        input: new $ZodTuple({
          type: "tuple",
          items: args[0],
          rest: args[1]
        }),
        output: inst._def.output
      });
    }
    return new F({
      type: "function",
      input: args[0],
      output: inst._def.output
    });
  };
  inst.output = (output) => {
    const F = inst.constructor;
    return new F({
      type: "function",
      input: inst._def.input,
      output
    });
  };
  return inst;
});
var $ZodPromise = /* @__PURE__ */ $constructor("$ZodPromise", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    return Promise.resolve(payload.value).then((inner) => def.innerType._zod.run({ value: inner, issues: [] }, ctx));
  };
});
var $ZodLazy = /* @__PURE__ */ $constructor("$ZodLazy", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "innerType", () => {
    const d = def;
    if (!d._cachedInner)
      d._cachedInner = def.getter();
    return d._cachedInner;
  });
  defineLazy(inst._zod, "pattern", () => inst._zod.innerType?._zod?.pattern);
  defineLazy(inst._zod, "propValues", () => inst._zod.innerType?._zod?.propValues);
  defineLazy(inst._zod, "optin", () => inst._zod.innerType?._zod?.optin ?? void 0);
  defineLazy(inst._zod, "optout", () => inst._zod.innerType?._zod?.optout ?? void 0);
  inst._zod.parse = (payload, ctx) => {
    const inner = inst._zod.innerType;
    return inner._zod.run(payload, ctx);
  };
});
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// node_modules/zod/v4/locales/index.js
var locales_exports = {};
__export(locales_exports, {
  ar: () => ar_default,
  az: () => az_default,
  be: () => be_default,
  bg: () => bg_default,
  ca: () => ca_default,
  cs: () => cs_default,
  da: () => da_default,
  de: () => de_default,
  el: () => el_default,
  en: () => en_default,
  eo: () => eo_default,
  es: () => es_default,
  fa: () => fa_default,
  fi: () => fi_default,
  fr: () => fr_default,
  frCA: () => fr_CA_default,
  he: () => he_default,
  hr: () => hr_default,
  hu: () => hu_default,
  hy: () => hy_default,
  id: () => id_default,
  is: () => is_default,
  it: () => it_default,
  ja: () => ja_default,
  ka: () => ka_default,
  kh: () => kh_default,
  km: () => km_default,
  ko: () => ko_default,
  lt: () => lt_default,
  mk: () => mk_default,
  ms: () => ms_default,
  nl: () => nl_default,
  no: () => no_default,
  ota: () => ota_default,
  pl: () => pl_default,
  ps: () => ps_default,
  pt: () => pt_default,
  ro: () => ro_default,
  ru: () => ru_default,
  sl: () => sl_default,
  sv: () => sv_default,
  ta: () => ta_default,
  th: () => th_default,
  tr: () => tr_default,
  ua: () => ua_default,
  uk: () => uk_default,
  ur: () => ur_default,
  uz: () => uz_default,
  vi: () => vi_default,
  yo: () => yo_default,
  zhCN: () => zh_CN_default,
  zhTW: () => zh_TW_default
});

// node_modules/zod/v4/locales/ar.js
var error = () => {
  const Sizable = {
    string: { unit: "\u062D\u0631\u0641", verb: "\u0623\u0646 \u064A\u062D\u0648\u064A" },
    file: { unit: "\u0628\u0627\u064A\u062A", verb: "\u0623\u0646 \u064A\u062D\u0648\u064A" },
    array: { unit: "\u0639\u0646\u0635\u0631", verb: "\u0623\u0646 \u064A\u062D\u0648\u064A" },
    set: { unit: "\u0639\u0646\u0635\u0631", verb: "\u0623\u0646 \u064A\u062D\u0648\u064A" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0645\u062F\u062E\u0644",
    email: "\u0628\u0631\u064A\u062F \u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A",
    url: "\u0631\u0627\u0628\u0637",
    emoji: "\u0625\u064A\u0645\u0648\u062C\u064A",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\u062A\u0627\u0631\u064A\u062E \u0648\u0648\u0642\u062A \u0628\u0645\u0639\u064A\u0627\u0631 ISO",
    date: "\u062A\u0627\u0631\u064A\u062E \u0628\u0645\u0639\u064A\u0627\u0631 ISO",
    time: "\u0648\u0642\u062A \u0628\u0645\u0639\u064A\u0627\u0631 ISO",
    duration: "\u0645\u062F\u0629 \u0628\u0645\u0639\u064A\u0627\u0631 ISO",
    ipv4: "\u0639\u0646\u0648\u0627\u0646 IPv4",
    ipv6: "\u0639\u0646\u0648\u0627\u0646 IPv6",
    cidrv4: "\u0645\u062F\u0649 \u0639\u0646\u0627\u0648\u064A\u0646 \u0628\u0635\u064A\u063A\u0629 IPv4",
    cidrv6: "\u0645\u062F\u0649 \u0639\u0646\u0627\u0648\u064A\u0646 \u0628\u0635\u064A\u063A\u0629 IPv6",
    base64: "\u0646\u064E\u0635 \u0628\u062A\u0631\u0645\u064A\u0632 base64-encoded",
    base64url: "\u0646\u064E\u0635 \u0628\u062A\u0631\u0645\u064A\u0632 base64url-encoded",
    json_string: "\u0646\u064E\u0635 \u0639\u0644\u0649 \u0647\u064A\u0626\u0629 JSON",
    e164: "\u0631\u0642\u0645 \u0647\u0627\u062A\u0641 \u0628\u0645\u0639\u064A\u0627\u0631 E.164",
    jwt: "JWT",
    template_literal: "\u0645\u062F\u062E\u0644"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u0645\u062F\u062E\u0644\u0627\u062A \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644\u0629: \u064A\u0641\u062A\u0631\u0636 \u0625\u062F\u062E\u0627\u0644 instanceof ${issue2.expected}\u060C \u0648\u0644\u0643\u0646 \u062A\u0645 \u0625\u062F\u062E\u0627\u0644 ${received}`;
        }
        return `\u0645\u062F\u062E\u0644\u0627\u062A \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644\u0629: \u064A\u0641\u062A\u0631\u0636 \u0625\u062F\u062E\u0627\u0644 ${expected}\u060C \u0648\u0644\u0643\u0646 \u062A\u0645 \u0625\u062F\u062E\u0627\u0644 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u0645\u062F\u062E\u0644\u0627\u062A \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644\u0629: \u064A\u0641\u062A\u0631\u0636 \u0625\u062F\u062E\u0627\u0644 ${stringifyPrimitive(issue2.values[0])}`;
        return `\u0627\u062E\u062A\u064A\u0627\u0631 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644: \u064A\u062A\u0648\u0642\u0639 \u0627\u0646\u062A\u0642\u0627\u0621 \u0623\u062D\u062F \u0647\u0630\u0647 \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u062A: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return ` \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u0644\u0627\u0632\u0645: \u064A\u0641\u062A\u0631\u0636 \u0623\u0646 \u062A\u0643\u0648\u0646 ${issue2.origin ?? "\u0627\u0644\u0642\u064A\u0645\u0629"} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "\u0639\u0646\u0635\u0631"}`;
        return `\u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u0644\u0627\u0632\u0645: \u064A\u0641\u062A\u0631\u0636 \u0623\u0646 \u062A\u0643\u0648\u0646 ${issue2.origin ?? "\u0627\u0644\u0642\u064A\u0645\u0629"} ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0623\u0635\u063A\u0631 \u0645\u0646 \u0627\u0644\u0644\u0627\u0632\u0645: \u064A\u0641\u062A\u0631\u0636 \u0644\u0640 ${issue2.origin} \u0623\u0646 \u064A\u0643\u0648\u0646 ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u0623\u0635\u063A\u0631 \u0645\u0646 \u0627\u0644\u0644\u0627\u0632\u0645: \u064A\u0641\u062A\u0631\u0636 \u0644\u0640 ${issue2.origin} \u0623\u0646 \u064A\u0643\u0648\u0646 ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u0646\u064E\u0635 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644: \u064A\u062C\u0628 \u0623\u0646 \u064A\u0628\u062F\u0623 \u0628\u0640 "${issue2.prefix}"`;
        if (_issue.format === "ends_with")
          return `\u0646\u064E\u0635 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644: \u064A\u062C\u0628 \u0623\u0646 \u064A\u0646\u062A\u0647\u064A \u0628\u0640 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u0646\u064E\u0635 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644: \u064A\u062C\u0628 \u0623\u0646 \u064A\u062A\u0636\u0645\u0651\u064E\u0646 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u0646\u064E\u0635 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644: \u064A\u062C\u0628 \u0623\u0646 \u064A\u0637\u0627\u0628\u0642 \u0627\u0644\u0646\u0645\u0637 ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644`;
      }
      case "not_multiple_of":
        return `\u0631\u0642\u0645 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644: \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0645\u0646 \u0645\u0636\u0627\u0639\u0641\u0627\u062A ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u0645\u0639\u0631\u0641${issue2.keys.length > 1 ? "\u0627\u062A" : ""} \u063A\u0631\u064A\u0628${issue2.keys.length > 1 ? "\u0629" : ""}: ${joinValues(issue2.keys, "\u060C ")}`;
      case "invalid_key":
        return `\u0645\u0639\u0631\u0641 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644 \u0641\u064A ${issue2.origin}`;
      case "invalid_union":
        return "\u0645\u062F\u062E\u0644 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644";
      case "invalid_element":
        return `\u0645\u062F\u062E\u0644 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644 \u0641\u064A ${issue2.origin}`;
      default:
        return "\u0645\u062F\u062E\u0644 \u063A\u064A\u0631 \u0645\u0642\u0628\u0648\u0644";
    }
  };
};
function ar_default() {
  return {
    localeError: error()
  };
}

// node_modules/zod/v4/locales/az.js
var error2 = () => {
  const Sizable = {
    string: { unit: "simvol", verb: "olmal\u0131d\u0131r" },
    file: { unit: "bayt", verb: "olmal\u0131d\u0131r" },
    array: { unit: "element", verb: "olmal\u0131d\u0131r" },
    set: { unit: "element", verb: "olmal\u0131d\u0131r" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Yanl\u0131\u015F d\u0259y\u0259r: g\xF6zl\u0259nil\u0259n instanceof ${issue2.expected}, daxil olan ${received}`;
        }
        return `Yanl\u0131\u015F d\u0259y\u0259r: g\xF6zl\u0259nil\u0259n ${expected}, daxil olan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Yanl\u0131\u015F d\u0259y\u0259r: g\xF6zl\u0259nil\u0259n ${stringifyPrimitive(issue2.values[0])}`;
        return `Yanl\u0131\u015F se\xE7im: a\u015Fa\u011F\u0131dak\u0131lardan biri olmal\u0131d\u0131r: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\xC7ox b\xF6y\xFCk: g\xF6zl\u0259nil\u0259n ${issue2.origin ?? "d\u0259y\u0259r"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "element"}`;
        return `\xC7ox b\xF6y\xFCk: g\xF6zl\u0259nil\u0259n ${issue2.origin ?? "d\u0259y\u0259r"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\xC7ox ki\xE7ik: g\xF6zl\u0259nil\u0259n ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `\xC7ox ki\xE7ik: g\xF6zl\u0259nil\u0259n ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Yanl\u0131\u015F m\u0259tn: "${_issue.prefix}" il\u0259 ba\u015Flamal\u0131d\u0131r`;
        if (_issue.format === "ends_with")
          return `Yanl\u0131\u015F m\u0259tn: "${_issue.suffix}" il\u0259 bitm\u0259lidir`;
        if (_issue.format === "includes")
          return `Yanl\u0131\u015F m\u0259tn: "${_issue.includes}" daxil olmal\u0131d\u0131r`;
        if (_issue.format === "regex")
          return `Yanl\u0131\u015F m\u0259tn: ${_issue.pattern} \u015Fablonuna uy\u011Fun olmal\u0131d\u0131r`;
        return `Yanl\u0131\u015F ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Yanl\u0131\u015F \u0259d\u0259d: ${issue2.divisor} il\u0259 b\xF6l\xFCn\u0259 bil\u0259n olmal\u0131d\u0131r`;
      case "unrecognized_keys":
        return `Tan\u0131nmayan a\xE7ar${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} daxilind\u0259 yanl\u0131\u015F a\xE7ar`;
      case "invalid_union":
        return "Yanl\u0131\u015F d\u0259y\u0259r";
      case "invalid_element":
        return `${issue2.origin} daxilind\u0259 yanl\u0131\u015F d\u0259y\u0259r`;
      default:
        return `Yanl\u0131\u015F d\u0259y\u0259r`;
    }
  };
};
function az_default() {
  return {
    localeError: error2()
  };
}

// node_modules/zod/v4/locales/be.js
function getBelarusianPlural(count, one, few, many) {
  const absCount = Math.abs(count);
  const lastDigit = absCount % 10;
  const lastTwoDigits = absCount % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return many;
  }
  if (lastDigit === 1) {
    return one;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }
  return many;
}
var error3 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "\u0441\u0456\u043C\u0432\u0430\u043B",
        few: "\u0441\u0456\u043C\u0432\u0430\u043B\u044B",
        many: "\u0441\u0456\u043C\u0432\u0430\u043B\u0430\u045E"
      },
      verb: "\u043C\u0435\u0446\u044C"
    },
    array: {
      unit: {
        one: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442",
        few: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B",
        many: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430\u045E"
      },
      verb: "\u043C\u0435\u0446\u044C"
    },
    set: {
      unit: {
        one: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442",
        few: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B",
        many: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430\u045E"
      },
      verb: "\u043C\u0435\u0446\u044C"
    },
    file: {
      unit: {
        one: "\u0431\u0430\u0439\u0442",
        few: "\u0431\u0430\u0439\u0442\u044B",
        many: "\u0431\u0430\u0439\u0442\u0430\u045E"
      },
      verb: "\u043C\u0435\u0446\u044C"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0443\u0432\u043E\u0434",
    email: "email \u0430\u0434\u0440\u0430\u0441",
    url: "URL",
    emoji: "\u044D\u043C\u043E\u0434\u0437\u0456",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u0434\u0430\u0442\u0430 \u0456 \u0447\u0430\u0441",
    date: "ISO \u0434\u0430\u0442\u0430",
    time: "ISO \u0447\u0430\u0441",
    duration: "ISO \u043F\u0440\u0430\u0446\u044F\u0433\u043B\u0430\u0441\u0446\u044C",
    ipv4: "IPv4 \u0430\u0434\u0440\u0430\u0441",
    ipv6: "IPv6 \u0430\u0434\u0440\u0430\u0441",
    cidrv4: "IPv4 \u0434\u044B\u044F\u043F\u0430\u0437\u043E\u043D",
    cidrv6: "IPv6 \u0434\u044B\u044F\u043F\u0430\u0437\u043E\u043D",
    base64: "\u0440\u0430\u0434\u043E\u043A \u0443 \u0444\u0430\u0440\u043C\u0430\u0446\u0435 base64",
    base64url: "\u0440\u0430\u0434\u043E\u043A \u0443 \u0444\u0430\u0440\u043C\u0430\u0446\u0435 base64url",
    json_string: "JSON \u0440\u0430\u0434\u043E\u043A",
    e164: "\u043D\u0443\u043C\u0430\u0440 E.164",
    jwt: "JWT",
    template_literal: "\u0443\u0432\u043E\u0434"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u043B\u0456\u043A",
    array: "\u043C\u0430\u0441\u0456\u045E"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u045E\u0432\u043E\u0434: \u0447\u0430\u043A\u0430\u045E\u0441\u044F instanceof ${issue2.expected}, \u0430\u0442\u0440\u044B\u043C\u0430\u043D\u0430 ${received}`;
        }
        return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u045E\u0432\u043E\u0434: \u0447\u0430\u043A\u0430\u045E\u0441\u044F ${expected}, \u0430\u0442\u0440\u044B\u043C\u0430\u043D\u0430 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u045E\u0432\u043E\u0434: \u0447\u0430\u043A\u0430\u043B\u0430\u0441\u044F ${stringifyPrimitive(issue2.values[0])}`;
        return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u0432\u0430\u0440\u044B\u044F\u043D\u0442: \u0447\u0430\u043A\u0430\u045E\u0441\u044F \u0430\u0434\u0437\u0456\u043D \u0437 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getBelarusianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `\u0417\u0430\u043D\u0430\u0434\u0442\u0430 \u0432\u044F\u043B\u0456\u043A\u0456: \u0447\u0430\u043A\u0430\u043B\u0430\u0441\u044F, \u0448\u0442\u043E ${issue2.origin ?? "\u0437\u043D\u0430\u0447\u044D\u043D\u043D\u0435"} \u043F\u0430\u0432\u0456\u043D\u043D\u0430 ${sizing.verb} ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `\u0417\u0430\u043D\u0430\u0434\u0442\u0430 \u0432\u044F\u043B\u0456\u043A\u0456: \u0447\u0430\u043A\u0430\u043B\u0430\u0441\u044F, \u0448\u0442\u043E ${issue2.origin ?? "\u0437\u043D\u0430\u0447\u044D\u043D\u043D\u0435"} \u043F\u0430\u0432\u0456\u043D\u043D\u0430 \u0431\u044B\u0446\u044C ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getBelarusianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `\u0417\u0430\u043D\u0430\u0434\u0442\u0430 \u043C\u0430\u043B\u044B: \u0447\u0430\u043A\u0430\u043B\u0430\u0441\u044F, \u0448\u0442\u043E ${issue2.origin} \u043F\u0430\u0432\u0456\u043D\u043D\u0430 ${sizing.verb} ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `\u0417\u0430\u043D\u0430\u0434\u0442\u0430 \u043C\u0430\u043B\u044B: \u0447\u0430\u043A\u0430\u043B\u0430\u0441\u044F, \u0448\u0442\u043E ${issue2.origin} \u043F\u0430\u0432\u0456\u043D\u043D\u0430 \u0431\u044B\u0446\u044C ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u0440\u0430\u0434\u043E\u043A: \u043F\u0430\u0432\u0456\u043D\u0435\u043D \u043F\u0430\u0447\u044B\u043D\u0430\u0446\u0446\u0430 \u0437 "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u0440\u0430\u0434\u043E\u043A: \u043F\u0430\u0432\u0456\u043D\u0435\u043D \u0437\u0430\u043A\u0430\u043D\u0447\u0432\u0430\u0446\u0446\u0430 \u043D\u0430 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u0440\u0430\u0434\u043E\u043A: \u043F\u0430\u0432\u0456\u043D\u0435\u043D \u0437\u043C\u044F\u0448\u0447\u0430\u0446\u044C "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u0440\u0430\u0434\u043E\u043A: \u043F\u0430\u0432\u0456\u043D\u0435\u043D \u0430\u0434\u043F\u0430\u0432\u044F\u0434\u0430\u0446\u044C \u0448\u0430\u0431\u043B\u043E\u043D\u0443 ${_issue.pattern}`;
        return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u043B\u0456\u043A: \u043F\u0430\u0432\u0456\u043D\u0435\u043D \u0431\u044B\u0446\u044C \u043A\u0440\u0430\u0442\u043D\u044B\u043C ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u041D\u0435\u0440\u0430\u0441\u043F\u0430\u0437\u043D\u0430\u043D\u044B ${issue2.keys.length > 1 ? "\u043A\u043B\u044E\u0447\u044B" : "\u043A\u043B\u044E\u0447"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u043A\u043B\u044E\u0447 \u0443 ${issue2.origin}`;
      case "invalid_union":
        return "\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u045E\u0432\u043E\u0434";
      case "invalid_element":
        return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u0430\u0435 \u0437\u043D\u0430\u0447\u044D\u043D\u043D\u0435 \u045E ${issue2.origin}`;
      default:
        return `\u041D\u044F\u043F\u0440\u0430\u0432\u0456\u043B\u044C\u043D\u044B \u045E\u0432\u043E\u0434`;
    }
  };
};
function be_default() {
  return {
    localeError: error3()
  };
}

// node_modules/zod/v4/locales/bg.js
var error4 = () => {
  const Sizable = {
    string: { unit: "\u0441\u0438\u043C\u0432\u043E\u043B\u0430", verb: "\u0434\u0430 \u0441\u044A\u0434\u044A\u0440\u0436\u0430" },
    file: { unit: "\u0431\u0430\u0439\u0442\u0430", verb: "\u0434\u0430 \u0441\u044A\u0434\u044A\u0440\u0436\u0430" },
    array: { unit: "\u0435\u043B\u0435\u043C\u0435\u043D\u0442\u0430", verb: "\u0434\u0430 \u0441\u044A\u0434\u044A\u0440\u0436\u0430" },
    set: { unit: "\u0435\u043B\u0435\u043C\u0435\u043D\u0442\u0430", verb: "\u0434\u0430 \u0441\u044A\u0434\u044A\u0440\u0436\u0430" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0432\u0445\u043E\u0434",
    email: "\u0438\u043C\u0435\u0439\u043B \u0430\u0434\u0440\u0435\u0441",
    url: "URL",
    emoji: "\u0435\u043C\u043E\u0434\u0436\u0438",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u0432\u0440\u0435\u043C\u0435",
    date: "ISO \u0434\u0430\u0442\u0430",
    time: "ISO \u0432\u0440\u0435\u043C\u0435",
    duration: "ISO \u043F\u0440\u043E\u0434\u044A\u043B\u0436\u0438\u0442\u0435\u043B\u043D\u043E\u0441\u0442",
    ipv4: "IPv4 \u0430\u0434\u0440\u0435\u0441",
    ipv6: "IPv6 \u0430\u0434\u0440\u0435\u0441",
    cidrv4: "IPv4 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D",
    cidrv6: "IPv6 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D",
    base64: "base64-\u043A\u043E\u0434\u0438\u0440\u0430\u043D \u043D\u0438\u0437",
    base64url: "base64url-\u043A\u043E\u0434\u0438\u0440\u0430\u043D \u043D\u0438\u0437",
    json_string: "JSON \u043D\u0438\u0437",
    e164: "E.164 \u043D\u043E\u043C\u0435\u0440",
    jwt: "JWT",
    template_literal: "\u0432\u0445\u043E\u0434"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0447\u0438\u0441\u043B\u043E",
    array: "\u043C\u0430\u0441\u0438\u0432"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u0432\u0445\u043E\u0434: \u043E\u0447\u0430\u043A\u0432\u0430\u043D instanceof ${issue2.expected}, \u043F\u043E\u043B\u0443\u0447\u0435\u043D ${received}`;
        }
        return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u0432\u0445\u043E\u0434: \u043E\u0447\u0430\u043A\u0432\u0430\u043D ${expected}, \u043F\u043E\u043B\u0443\u0447\u0435\u043D ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u0432\u0445\u043E\u0434: \u043E\u0447\u0430\u043A\u0432\u0430\u043D ${stringifyPrimitive(issue2.values[0])}`;
        return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u0430 \u043E\u043F\u0446\u0438\u044F: \u043E\u0447\u0430\u043A\u0432\u0430\u043D\u043E \u0435\u0434\u043D\u043E \u043E\u0442 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u0422\u0432\u044A\u0440\u0434\u0435 \u0433\u043E\u043B\u044F\u043C\u043E: \u043E\u0447\u0430\u043A\u0432\u0430 \u0441\u0435 ${issue2.origin ?? "\u0441\u0442\u043E\u0439\u043D\u043E\u0441\u0442"} \u0434\u0430 \u0441\u044A\u0434\u044A\u0440\u0436\u0430 ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u0435\u043B\u0435\u043C\u0435\u043D\u0442\u0430"}`;
        return `\u0422\u0432\u044A\u0440\u0434\u0435 \u0433\u043E\u043B\u044F\u043C\u043E: \u043E\u0447\u0430\u043A\u0432\u0430 \u0441\u0435 ${issue2.origin ?? "\u0441\u0442\u043E\u0439\u043D\u043E\u0441\u0442"} \u0434\u0430 \u0431\u044A\u0434\u0435 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0422\u0432\u044A\u0440\u0434\u0435 \u043C\u0430\u043B\u043A\u043E: \u043E\u0447\u0430\u043A\u0432\u0430 \u0441\u0435 ${issue2.origin} \u0434\u0430 \u0441\u044A\u0434\u044A\u0440\u0436\u0430 ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u0422\u0432\u044A\u0440\u0434\u0435 \u043C\u0430\u043B\u043A\u043E: \u043E\u0447\u0430\u043A\u0432\u0430 \u0441\u0435 ${issue2.origin} \u0434\u0430 \u0431\u044A\u0434\u0435 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u043D\u0438\u0437: \u0442\u0440\u044F\u0431\u0432\u0430 \u0434\u0430 \u0437\u0430\u043F\u043E\u0447\u0432\u0430 \u0441 "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u043D\u0438\u0437: \u0442\u0440\u044F\u0431\u0432\u0430 \u0434\u0430 \u0437\u0430\u0432\u044A\u0440\u0448\u0432\u0430 \u0441 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u043D\u0438\u0437: \u0442\u0440\u044F\u0431\u0432\u0430 \u0434\u0430 \u0432\u043A\u043B\u044E\u0447\u0432\u0430 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u043D\u0438\u0437: \u0442\u0440\u044F\u0431\u0432\u0430 \u0434\u0430 \u0441\u044A\u0432\u043F\u0430\u0434\u0430 \u0441 ${_issue.pattern}`;
        let invalid_adj = "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D";
        if (_issue.format === "emoji")
          invalid_adj = "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u043E";
        if (_issue.format === "datetime")
          invalid_adj = "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u043E";
        if (_issue.format === "date")
          invalid_adj = "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u0430";
        if (_issue.format === "time")
          invalid_adj = "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u043E";
        if (_issue.format === "duration")
          invalid_adj = "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u0430";
        return `${invalid_adj} ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u043E \u0447\u0438\u0441\u043B\u043E: \u0442\u0440\u044F\u0431\u0432\u0430 \u0434\u0430 \u0431\u044A\u0434\u0435 \u043A\u0440\u0430\u0442\u043D\u043E \u043D\u0430 ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u041D\u0435\u0440\u0430\u0437\u043F\u043E\u0437\u043D\u0430\u0442${issue2.keys.length > 1 ? "\u0438" : ""} \u043A\u043B\u044E\u0447${issue2.keys.length > 1 ? "\u043E\u0432\u0435" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0432 ${issue2.origin}`;
      case "invalid_union":
        return "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u0432\u0445\u043E\u0434";
      case "invalid_element":
        return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u0430 \u0441\u0442\u043E\u0439\u043D\u043E\u0441\u0442 \u0432 ${issue2.origin}`;
      default:
        return `\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u0432\u0445\u043E\u0434`;
    }
  };
};
function bg_default() {
  return {
    localeError: error4()
  };
}

// node_modules/zod/v4/locales/ca.js
var error5 = () => {
  const Sizable = {
    string: { unit: "car\xE0cters", verb: "contenir" },
    file: { unit: "bytes", verb: "contenir" },
    array: { unit: "elements", verb: "contenir" },
    set: { unit: "elements", verb: "contenir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entrada",
    email: "adre\xE7a electr\xF2nica",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data i hora ISO",
    date: "data ISO",
    time: "hora ISO",
    duration: "durada ISO",
    ipv4: "adre\xE7a IPv4",
    ipv6: "adre\xE7a IPv6",
    cidrv4: "rang IPv4",
    cidrv6: "rang IPv6",
    base64: "cadena codificada en base64",
    base64url: "cadena codificada en base64url",
    json_string: "cadena JSON",
    e164: "n\xFAmero E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Tipus inv\xE0lid: s'esperava instanceof ${issue2.expected}, s'ha rebut ${received}`;
        }
        return `Tipus inv\xE0lid: s'esperava ${expected}, s'ha rebut ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Valor inv\xE0lid: s'esperava ${stringifyPrimitive(issue2.values[0])}`;
        return `Opci\xF3 inv\xE0lida: s'esperava una de ${joinValues(issue2.values, " o ")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "com a m\xE0xim" : "menys de";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Massa gran: s'esperava que ${issue2.origin ?? "el valor"} contingu\xE9s ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Massa gran: s'esperava que ${issue2.origin ?? "el valor"} fos ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "com a m\xEDnim" : "m\xE9s de";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Massa petit: s'esperava que ${issue2.origin} contingu\xE9s ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Massa petit: s'esperava que ${issue2.origin} fos ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Format inv\xE0lid: ha de comen\xE7ar amb "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Format inv\xE0lid: ha d'acabar amb "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Format inv\xE0lid: ha d'incloure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Format inv\xE0lid: ha de coincidir amb el patr\xF3 ${_issue.pattern}`;
        return `Format inv\xE0lid per a ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `N\xFAmero inv\xE0lid: ha de ser m\xFAltiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Clau${issue2.keys.length > 1 ? "s" : ""} no reconeguda${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Clau inv\xE0lida a ${issue2.origin}`;
      case "invalid_union":
        return "Entrada inv\xE0lida";
      // Could also be "Tipus d'unió invàlid" but "Entrada invàlida" is more general
      case "invalid_element":
        return `Element inv\xE0lid a ${issue2.origin}`;
      default:
        return `Entrada inv\xE0lida`;
    }
  };
};
function ca_default() {
  return {
    localeError: error5()
  };
}

// node_modules/zod/v4/locales/cs.js
var error6 = () => {
  const Sizable = {
    string: { unit: "znak\u016F", verb: "m\xEDt" },
    file: { unit: "bajt\u016F", verb: "m\xEDt" },
    array: { unit: "prvk\u016F", verb: "m\xEDt" },
    set: { unit: "prvk\u016F", verb: "m\xEDt" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "regul\xE1rn\xED v\xFDraz",
    email: "e-mailov\xE1 adresa",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "datum a \u010Das ve form\xE1tu ISO",
    date: "datum ve form\xE1tu ISO",
    time: "\u010Das ve form\xE1tu ISO",
    duration: "doba trv\xE1n\xED ISO",
    ipv4: "IPv4 adresa",
    ipv6: "IPv6 adresa",
    cidrv4: "rozsah IPv4",
    cidrv6: "rozsah IPv6",
    base64: "\u0159et\u011Bzec zak\xF3dovan\xFD ve form\xE1tu base64",
    base64url: "\u0159et\u011Bzec zak\xF3dovan\xFD ve form\xE1tu base64url",
    json_string: "\u0159et\u011Bzec ve form\xE1tu JSON",
    e164: "\u010D\xEDslo E.164",
    jwt: "JWT",
    template_literal: "vstup"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u010D\xEDslo",
    string: "\u0159et\u011Bzec",
    function: "funkce",
    array: "pole"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Neplatn\xFD vstup: o\u010Dek\xE1v\xE1no instanceof ${issue2.expected}, obdr\u017Eeno ${received}`;
        }
        return `Neplatn\xFD vstup: o\u010Dek\xE1v\xE1no ${expected}, obdr\u017Eeno ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neplatn\xFD vstup: o\u010Dek\xE1v\xE1no ${stringifyPrimitive(issue2.values[0])}`;
        return `Neplatn\xE1 mo\u017Enost: o\u010Dek\xE1v\xE1na jedna z hodnot ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Hodnota je p\u0159\xEDli\u0161 velk\xE1: ${issue2.origin ?? "hodnota"} mus\xED m\xEDt ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "prvk\u016F"}`;
        }
        return `Hodnota je p\u0159\xEDli\u0161 velk\xE1: ${issue2.origin ?? "hodnota"} mus\xED b\xFDt ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Hodnota je p\u0159\xEDli\u0161 mal\xE1: ${issue2.origin ?? "hodnota"} mus\xED m\xEDt ${adj}${issue2.minimum.toString()} ${sizing.unit ?? "prvk\u016F"}`;
        }
        return `Hodnota je p\u0159\xEDli\u0161 mal\xE1: ${issue2.origin ?? "hodnota"} mus\xED b\xFDt ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Neplatn\xFD \u0159et\u011Bzec: mus\xED za\u010D\xEDnat na "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Neplatn\xFD \u0159et\u011Bzec: mus\xED kon\u010Dit na "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neplatn\xFD \u0159et\u011Bzec: mus\xED obsahovat "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neplatn\xFD \u0159et\u011Bzec: mus\xED odpov\xEDdat vzoru ${_issue.pattern}`;
        return `Neplatn\xFD form\xE1t ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neplatn\xE9 \u010D\xEDslo: mus\xED b\xFDt n\xE1sobkem ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Nezn\xE1m\xE9 kl\xED\u010De: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neplatn\xFD kl\xED\u010D v ${issue2.origin}`;
      case "invalid_union":
        return "Neplatn\xFD vstup";
      case "invalid_element":
        return `Neplatn\xE1 hodnota v ${issue2.origin}`;
      default:
        return `Neplatn\xFD vstup`;
    }
  };
};
function cs_default() {
  return {
    localeError: error6()
  };
}

// node_modules/zod/v4/locales/da.js
var error7 = () => {
  const Sizable = {
    string: { unit: "tegn", verb: "havde" },
    file: { unit: "bytes", verb: "havde" },
    array: { unit: "elementer", verb: "indeholdt" },
    set: { unit: "elementer", verb: "indeholdt" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "e-mailadresse",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dato- og klokkesl\xE6t",
    date: "ISO-dato",
    time: "ISO-klokkesl\xE6t",
    duration: "ISO-varighed",
    ipv4: "IPv4-omr\xE5de",
    ipv6: "IPv6-omr\xE5de",
    cidrv4: "IPv4-spektrum",
    cidrv6: "IPv6-spektrum",
    base64: "base64-kodet streng",
    base64url: "base64url-kodet streng",
    json_string: "JSON-streng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "streng",
    number: "tal",
    boolean: "boolean",
    array: "liste",
    object: "objekt",
    set: "s\xE6t",
    file: "fil"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ugyldigt input: forventede instanceof ${issue2.expected}, fik ${received}`;
        }
        return `Ugyldigt input: forventede ${expected}, fik ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ugyldig v\xE6rdi: forventede ${stringifyPrimitive(issue2.values[0])}`;
        return `Ugyldigt valg: forventede en af f\xF8lgende ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing)
          return `For stor: forventede ${origin ?? "value"} ${sizing.verb} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "elementer"}`;
        return `For stor: forventede ${origin ?? "value"} havde ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing) {
          return `For lille: forventede ${origin} ${sizing.verb} ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `For lille: forventede ${origin} havde ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ugyldig streng: skal starte med "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ugyldig streng: skal ende med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ugyldig streng: skal indeholde "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ugyldig streng: skal matche m\xF8nsteret ${_issue.pattern}`;
        return `Ugyldig ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ugyldigt tal: skal v\xE6re deleligt med ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Ukendte n\xF8gler" : "Ukendt n\xF8gle"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ugyldig n\xF8gle i ${issue2.origin}`;
      case "invalid_union":
        return "Ugyldigt input: matcher ingen af de tilladte typer";
      case "invalid_element":
        return `Ugyldig v\xE6rdi i ${issue2.origin}`;
      default:
        return `Ugyldigt input`;
    }
  };
};
function da_default() {
  return {
    localeError: error7()
  };
}

// node_modules/zod/v4/locales/de.js
var error8 = () => {
  const Sizable = {
    string: { unit: "Zeichen", verb: "zu haben" },
    file: { unit: "Bytes", verb: "zu haben" },
    array: { unit: "Elemente", verb: "zu haben" },
    set: { unit: "Elemente", verb: "zu haben" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "Eingabe",
    email: "E-Mail-Adresse",
    url: "URL",
    emoji: "Emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-Datum und -Uhrzeit",
    date: "ISO-Datum",
    time: "ISO-Uhrzeit",
    duration: "ISO-Dauer",
    ipv4: "IPv4-Adresse",
    ipv6: "IPv6-Adresse",
    cidrv4: "IPv4-Bereich",
    cidrv6: "IPv6-Bereich",
    base64: "Base64-codierter String",
    base64url: "Base64-URL-codierter String",
    json_string: "JSON-String",
    e164: "E.164-Nummer",
    jwt: "JWT",
    template_literal: "Eingabe"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "Zahl",
    array: "Array"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ung\xFCltige Eingabe: erwartet instanceof ${issue2.expected}, erhalten ${received}`;
        }
        return `Ung\xFCltige Eingabe: erwartet ${expected}, erhalten ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ung\xFCltige Eingabe: erwartet ${stringifyPrimitive(issue2.values[0])}`;
        return `Ung\xFCltige Option: erwartet eine von ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Zu gro\xDF: erwartet, dass ${issue2.origin ?? "Wert"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "Elemente"} hat`;
        return `Zu gro\xDF: erwartet, dass ${issue2.origin ?? "Wert"} ${adj}${issue2.maximum.toString()} ist`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Zu klein: erwartet, dass ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} hat`;
        }
        return `Zu klein: erwartet, dass ${issue2.origin} ${adj}${issue2.minimum.toString()} ist`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ung\xFCltiger String: muss mit "${_issue.prefix}" beginnen`;
        if (_issue.format === "ends_with")
          return `Ung\xFCltiger String: muss mit "${_issue.suffix}" enden`;
        if (_issue.format === "includes")
          return `Ung\xFCltiger String: muss "${_issue.includes}" enthalten`;
        if (_issue.format === "regex")
          return `Ung\xFCltiger String: muss dem Muster ${_issue.pattern} entsprechen`;
        return `Ung\xFCltig: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ung\xFCltige Zahl: muss ein Vielfaches von ${issue2.divisor} sein`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Unbekannte Schl\xFCssel" : "Unbekannter Schl\xFCssel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ung\xFCltiger Schl\xFCssel in ${issue2.origin}`;
      case "invalid_union":
        return "Ung\xFCltige Eingabe";
      case "invalid_element":
        return `Ung\xFCltiger Wert in ${issue2.origin}`;
      default:
        return `Ung\xFCltige Eingabe`;
    }
  };
};
function de_default() {
  return {
    localeError: error8()
  };
}

// node_modules/zod/v4/locales/el.js
var error9 = () => {
  const Sizable = {
    string: { unit: "\u03C7\u03B1\u03C1\u03B1\u03BA\u03C4\u03AE\u03C1\u03B5\u03C2", verb: "\u03BD\u03B1 \u03AD\u03C7\u03B5\u03B9" },
    file: { unit: "bytes", verb: "\u03BD\u03B1 \u03AD\u03C7\u03B5\u03B9" },
    array: { unit: "\u03C3\u03C4\u03BF\u03B9\u03C7\u03B5\u03AF\u03B1", verb: "\u03BD\u03B1 \u03AD\u03C7\u03B5\u03B9" },
    set: { unit: "\u03C3\u03C4\u03BF\u03B9\u03C7\u03B5\u03AF\u03B1", verb: "\u03BD\u03B1 \u03AD\u03C7\u03B5\u03B9" },
    map: { unit: "\u03BA\u03B1\u03C4\u03B1\u03C7\u03C9\u03C1\u03AE\u03C3\u03B5\u03B9\u03C2", verb: "\u03BD\u03B1 \u03AD\u03C7\u03B5\u03B9" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u03B5\u03AF\u03C3\u03BF\u03B4\u03BF\u03C2",
    email: "\u03B4\u03B9\u03B5\u03CD\u03B8\u03C5\u03BD\u03C3\u03B7 email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u03B7\u03BC\u03B5\u03C1\u03BF\u03BC\u03B7\u03BD\u03AF\u03B1 \u03BA\u03B1\u03B9 \u03CE\u03C1\u03B1",
    date: "ISO \u03B7\u03BC\u03B5\u03C1\u03BF\u03BC\u03B7\u03BD\u03AF\u03B1",
    time: "ISO \u03CE\u03C1\u03B1",
    duration: "ISO \u03B4\u03B9\u03AC\u03C1\u03BA\u03B5\u03B9\u03B1",
    ipv4: "\u03B4\u03B9\u03B5\u03CD\u03B8\u03C5\u03BD\u03C3\u03B7 IPv4",
    ipv6: "\u03B4\u03B9\u03B5\u03CD\u03B8\u03C5\u03BD\u03C3\u03B7 IPv6",
    mac: "\u03B4\u03B9\u03B5\u03CD\u03B8\u03C5\u03BD\u03C3\u03B7 MAC",
    cidrv4: "\u03B5\u03CD\u03C1\u03BF\u03C2 IPv4",
    cidrv6: "\u03B5\u03CD\u03C1\u03BF\u03C2 IPv6",
    base64: "\u03C3\u03C5\u03BC\u03B2\u03BF\u03BB\u03BF\u03C3\u03B5\u03B9\u03C1\u03AC \u03BA\u03C9\u03B4\u03B9\u03BA\u03BF\u03C0\u03BF\u03B9\u03B7\u03BC\u03AD\u03BD\u03B7 \u03C3\u03B5 base64",
    base64url: "\u03C3\u03C5\u03BC\u03B2\u03BF\u03BB\u03BF\u03C3\u03B5\u03B9\u03C1\u03AC \u03BA\u03C9\u03B4\u03B9\u03BA\u03BF\u03C0\u03BF\u03B9\u03B7\u03BC\u03AD\u03BD\u03B7 \u03C3\u03B5 base64url",
    json_string: "\u03C3\u03C5\u03BC\u03B2\u03BF\u03BB\u03BF\u03C3\u03B5\u03B9\u03C1\u03AC JSON",
    e164: "\u03B1\u03C1\u03B9\u03B8\u03BC\u03CC\u03C2 E.164",
    jwt: "JWT",
    template_literal: "\u03B5\u03AF\u03C3\u03BF\u03B4\u03BF\u03C2"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (typeof issue2.expected === "string" && /^[A-Z]/.test(issue2.expected)) {
          return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03B5\u03AF\u03C3\u03BF\u03B4\u03BF\u03C2: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD instanceof ${issue2.expected}, \u03BB\u03AE\u03C6\u03B8\u03B7\u03BA\u03B5 ${received}`;
        }
        return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03B5\u03AF\u03C3\u03BF\u03B4\u03BF\u03C2: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD ${expected}, \u03BB\u03AE\u03C6\u03B8\u03B7\u03BA\u03B5 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03B5\u03AF\u03C3\u03BF\u03B4\u03BF\u03C2: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD ${stringifyPrimitive(issue2.values[0])}`;
        return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03B5\u03C0\u03B9\u03BB\u03BF\u03B3\u03AE: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD \u03AD\u03BD\u03B1 \u03B1\u03C0\u03CC ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u03A0\u03BF\u03BB\u03CD \u03BC\u03B5\u03B3\u03AC\u03BB\u03BF: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD ${issue2.origin ?? "\u03C4\u03B9\u03BC\u03AE"} \u03BD\u03B1 \u03AD\u03C7\u03B5\u03B9 ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u03C3\u03C4\u03BF\u03B9\u03C7\u03B5\u03AF\u03B1"}`;
        return `\u03A0\u03BF\u03BB\u03CD \u03BC\u03B5\u03B3\u03AC\u03BB\u03BF: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD ${issue2.origin ?? "\u03C4\u03B9\u03BC\u03AE"} \u03BD\u03B1 \u03B5\u03AF\u03BD\u03B1\u03B9 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u03A0\u03BF\u03BB\u03CD \u03BC\u03B9\u03BA\u03C1\u03CC: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD ${issue2.origin} \u03BD\u03B1 \u03AD\u03C7\u03B5\u03B9 ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u03A0\u03BF\u03BB\u03CD \u03BC\u03B9\u03BA\u03C1\u03CC: \u03B1\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03C4\u03B1\u03BD ${issue2.origin} \u03BD\u03B1 \u03B5\u03AF\u03BD\u03B1\u03B9 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03C3\u03C5\u03BC\u03B2\u03BF\u03BB\u03BF\u03C3\u03B5\u03B9\u03C1\u03AC: \u03C0\u03C1\u03AD\u03C0\u03B5\u03B9 \u03BD\u03B1 \u03BE\u03B5\u03BA\u03B9\u03BD\u03AC \u03BC\u03B5 "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03C3\u03C5\u03BC\u03B2\u03BF\u03BB\u03BF\u03C3\u03B5\u03B9\u03C1\u03AC: \u03C0\u03C1\u03AD\u03C0\u03B5\u03B9 \u03BD\u03B1 \u03C4\u03B5\u03BB\u03B5\u03B9\u03CE\u03BD\u03B5\u03B9 \u03BC\u03B5 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03C3\u03C5\u03BC\u03B2\u03BF\u03BB\u03BF\u03C3\u03B5\u03B9\u03C1\u03AC: \u03C0\u03C1\u03AD\u03C0\u03B5\u03B9 \u03BD\u03B1 \u03C0\u03B5\u03C1\u03B9\u03AD\u03C7\u03B5\u03B9 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03C3\u03C5\u03BC\u03B2\u03BF\u03BB\u03BF\u03C3\u03B5\u03B9\u03C1\u03AC: \u03C0\u03C1\u03AD\u03C0\u03B5\u03B9 \u03BD\u03B1 \u03C4\u03B1\u03B9\u03C1\u03B9\u03AC\u03B6\u03B5\u03B9 \u03BC\u03B5 \u03C4\u03BF \u03BC\u03BF\u03C4\u03AF\u03B2\u03BF ${_issue.pattern}`;
        return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03BF: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03BF\u03C2 \u03B1\u03C1\u03B9\u03B8\u03BC\u03CC\u03C2: \u03C0\u03C1\u03AD\u03C0\u03B5\u03B9 \u03BD\u03B1 \u03B5\u03AF\u03BD\u03B1\u03B9 \u03C0\u03BF\u03BB\u03BB\u03B1\u03C0\u03BB\u03AC\u03C3\u03B9\u03BF \u03C4\u03BF\u03C5 ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u0386\u03B3\u03BD\u03C9\u03C3\u03C4${issue2.keys.length > 1 ? "\u03B1" : "\u03BF"} \u03BA\u03BB\u03B5\u03B9\u03B4${issue2.keys.length > 1 ? "\u03B9\u03AC" : "\u03AF"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03BF \u03BA\u03BB\u03B5\u03B9\u03B4\u03AF \u03C3\u03C4\u03BF ${issue2.origin}`;
      case "invalid_union":
        return "\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03B5\u03AF\u03C3\u03BF\u03B4\u03BF\u03C2";
      case "invalid_element":
        return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03C4\u03B9\u03BC\u03AE \u03C3\u03C4\u03BF ${issue2.origin}`;
      default:
        return `\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03B7 \u03B5\u03AF\u03C3\u03BF\u03B4\u03BF\u03C2`;
    }
  };
};
function el_default() {
  return {
    localeError: error9()
  };
}

// node_modules/zod/v4/locales/en.js
var error10 = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error10()
  };
}

// node_modules/zod/v4/locales/eo.js
var error11 = () => {
  const Sizable = {
    string: { unit: "karaktrojn", verb: "havi" },
    file: { unit: "bajtojn", verb: "havi" },
    array: { unit: "elementojn", verb: "havi" },
    set: { unit: "elementojn", verb: "havi" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "enigo",
    email: "retadreso",
    url: "URL",
    emoji: "emo\u011Dio",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-datotempo",
    date: "ISO-dato",
    time: "ISO-tempo",
    duration: "ISO-da\u016Dro",
    ipv4: "IPv4-adreso",
    ipv6: "IPv6-adreso",
    cidrv4: "IPv4-rango",
    cidrv6: "IPv6-rango",
    base64: "64-ume kodita karaktraro",
    base64url: "URL-64-ume kodita karaktraro",
    json_string: "JSON-karaktraro",
    e164: "E.164-nombro",
    jwt: "JWT",
    template_literal: "enigo"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "nombro",
    array: "tabelo",
    null: "senvalora"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Nevalida enigo: atendi\u011Dis instanceof ${issue2.expected}, ricevi\u011Dis ${received}`;
        }
        return `Nevalida enigo: atendi\u011Dis ${expected}, ricevi\u011Dis ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Nevalida enigo: atendi\u011Dis ${stringifyPrimitive(issue2.values[0])}`;
        return `Nevalida opcio: atendi\u011Dis unu el ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Tro granda: atendi\u011Dis ke ${issue2.origin ?? "valoro"} havu ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementojn"}`;
        return `Tro granda: atendi\u011Dis ke ${issue2.origin ?? "valoro"} havu ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Tro malgranda: atendi\u011Dis ke ${issue2.origin} havu ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Tro malgranda: atendi\u011Dis ke ${issue2.origin} estu ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Nevalida karaktraro: devas komenci\u011Di per "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Nevalida karaktraro: devas fini\u011Di per "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Nevalida karaktraro: devas inkluzivi "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Nevalida karaktraro: devas kongrui kun la modelo ${_issue.pattern}`;
        return `Nevalida ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nevalida nombro: devas esti oblo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Nekonata${issue2.keys.length > 1 ? "j" : ""} \u015Dlosilo${issue2.keys.length > 1 ? "j" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Nevalida \u015Dlosilo en ${issue2.origin}`;
      case "invalid_union":
        return "Nevalida enigo";
      case "invalid_element":
        return `Nevalida valoro en ${issue2.origin}`;
      default:
        return `Nevalida enigo`;
    }
  };
};
function eo_default() {
  return {
    localeError: error11()
  };
}

// node_modules/zod/v4/locales/es.js
var error12 = () => {
  const Sizable = {
    string: { unit: "caracteres", verb: "tener" },
    file: { unit: "bytes", verb: "tener" },
    array: { unit: "elementos", verb: "tener" },
    set: { unit: "elementos", verb: "tener" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entrada",
    email: "direcci\xF3n de correo electr\xF3nico",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "fecha y hora ISO",
    date: "fecha ISO",
    time: "hora ISO",
    duration: "duraci\xF3n ISO",
    ipv4: "direcci\xF3n IPv4",
    ipv6: "direcci\xF3n IPv6",
    cidrv4: "rango IPv4",
    cidrv6: "rango IPv6",
    base64: "cadena codificada en base64",
    base64url: "URL codificada en base64",
    json_string: "cadena JSON",
    e164: "n\xFAmero E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "texto",
    number: "n\xFAmero",
    boolean: "booleano",
    array: "arreglo",
    object: "objeto",
    set: "conjunto",
    file: "archivo",
    date: "fecha",
    bigint: "n\xFAmero grande",
    symbol: "s\xEDmbolo",
    undefined: "indefinido",
    null: "nulo",
    function: "funci\xF3n",
    map: "mapa",
    record: "registro",
    tuple: "tupla",
    enum: "enumeraci\xF3n",
    union: "uni\xF3n",
    literal: "literal",
    promise: "promesa",
    void: "vac\xEDo",
    never: "nunca",
    unknown: "desconocido",
    any: "cualquiera"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Entrada inv\xE1lida: se esperaba instanceof ${issue2.expected}, recibido ${received}`;
        }
        return `Entrada inv\xE1lida: se esperaba ${expected}, recibido ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrada inv\xE1lida: se esperaba ${stringifyPrimitive(issue2.values[0])}`;
        return `Opci\xF3n inv\xE1lida: se esperaba una de ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing)
          return `Demasiado grande: se esperaba que ${origin ?? "valor"} tuviera ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementos"}`;
        return `Demasiado grande: se esperaba que ${origin ?? "valor"} fuera ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing) {
          return `Demasiado peque\xF1o: se esperaba que ${origin} tuviera ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Demasiado peque\xF1o: se esperaba que ${origin} fuera ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Cadena inv\xE1lida: debe comenzar con "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Cadena inv\xE1lida: debe terminar en "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Cadena inv\xE1lida: debe incluir "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Cadena inv\xE1lida: debe coincidir con el patr\xF3n ${_issue.pattern}`;
        return `Inv\xE1lido ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `N\xFAmero inv\xE1lido: debe ser m\xFAltiplo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Llave${issue2.keys.length > 1 ? "s" : ""} desconocida${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Llave inv\xE1lida en ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      case "invalid_union":
        return "Entrada inv\xE1lida";
      case "invalid_element":
        return `Valor inv\xE1lido en ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      default:
        return `Entrada inv\xE1lida`;
    }
  };
};
function es_default() {
  return {
    localeError: error12()
  };
}

// node_modules/zod/v4/locales/fa.js
var error13 = () => {
  const Sizable = {
    string: { unit: "\u06A9\u0627\u0631\u0627\u06A9\u062A\u0631", verb: "\u062F\u0627\u0634\u062A\u0647 \u0628\u0627\u0634\u062F" },
    file: { unit: "\u0628\u0627\u06CC\u062A", verb: "\u062F\u0627\u0634\u062A\u0647 \u0628\u0627\u0634\u062F" },
    array: { unit: "\u0622\u06CC\u062A\u0645", verb: "\u062F\u0627\u0634\u062A\u0647 \u0628\u0627\u0634\u062F" },
    set: { unit: "\u0622\u06CC\u062A\u0645", verb: "\u062F\u0627\u0634\u062A\u0647 \u0628\u0627\u0634\u062F" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0648\u0631\u0648\u062F\u06CC",
    email: "\u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644",
    url: "URL",
    emoji: "\u0627\u06CC\u0645\u0648\u062C\u06CC",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\u062A\u0627\u0631\u06CC\u062E \u0648 \u0632\u0645\u0627\u0646 \u0627\u06CC\u0632\u0648",
    date: "\u062A\u0627\u0631\u06CC\u062E \u0627\u06CC\u0632\u0648",
    time: "\u0632\u0645\u0627\u0646 \u0627\u06CC\u0632\u0648",
    duration: "\u0645\u062F\u062A \u0632\u0645\u0627\u0646 \u0627\u06CC\u0632\u0648",
    ipv4: "IPv4 \u0622\u062F\u0631\u0633",
    ipv6: "IPv6 \u0622\u062F\u0631\u0633",
    cidrv4: "IPv4 \u062F\u0627\u0645\u0646\u0647",
    cidrv6: "IPv6 \u062F\u0627\u0645\u0646\u0647",
    base64: "base64-encoded \u0631\u0634\u062A\u0647",
    base64url: "base64url-encoded \u0631\u0634\u062A\u0647",
    json_string: "JSON \u0631\u0634\u062A\u0647",
    e164: "E.164 \u0639\u062F\u062F",
    jwt: "JWT",
    template_literal: "\u0648\u0631\u0648\u062F\u06CC"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0639\u062F\u062F",
    array: "\u0622\u0631\u0627\u06CC\u0647"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u0648\u0631\u0648\u062F\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0645\u06CC\u200C\u0628\u0627\u06CC\u0633\u062A instanceof ${issue2.expected} \u0645\u06CC\u200C\u0628\u0648\u062F\u060C ${received} \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F`;
        }
        return `\u0648\u0631\u0648\u062F\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0645\u06CC\u200C\u0628\u0627\u06CC\u0633\u062A ${expected} \u0645\u06CC\u200C\u0628\u0648\u062F\u060C ${received} \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F`;
      }
      case "invalid_value":
        if (issue2.values.length === 1) {
          return `\u0648\u0631\u0648\u062F\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0645\u06CC\u200C\u0628\u0627\u06CC\u0633\u062A ${stringifyPrimitive(issue2.values[0])} \u0645\u06CC\u200C\u0628\u0648\u062F`;
        }
        return `\u06AF\u0632\u06CC\u0646\u0647 \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0645\u06CC\u200C\u0628\u0627\u06CC\u0633\u062A \u06CC\u06A9\u06CC \u0627\u0632 ${joinValues(issue2.values, "|")} \u0645\u06CC\u200C\u0628\u0648\u062F`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u062E\u06CC\u0644\u06CC \u0628\u0632\u0631\u06AF: ${issue2.origin ?? "\u0645\u0642\u062F\u0627\u0631"} \u0628\u0627\u06CC\u062F ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u0639\u0646\u0635\u0631"} \u0628\u0627\u0634\u062F`;
        }
        return `\u062E\u06CC\u0644\u06CC \u0628\u0632\u0631\u06AF: ${issue2.origin ?? "\u0645\u0642\u062F\u0627\u0631"} \u0628\u0627\u06CC\u062F ${adj}${issue2.maximum.toString()} \u0628\u0627\u0634\u062F`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u062E\u06CC\u0644\u06CC \u06A9\u0648\u0686\u06A9: ${issue2.origin} \u0628\u0627\u06CC\u062F ${adj}${issue2.minimum.toString()} ${sizing.unit} \u0628\u0627\u0634\u062F`;
        }
        return `\u062E\u06CC\u0644\u06CC \u06A9\u0648\u0686\u06A9: ${issue2.origin} \u0628\u0627\u06CC\u062F ${adj}${issue2.minimum.toString()} \u0628\u0627\u0634\u062F`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u0631\u0634\u062A\u0647 \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0628\u0627\u06CC\u062F \u0628\u0627 "${_issue.prefix}" \u0634\u0631\u0648\u0639 \u0634\u0648\u062F`;
        }
        if (_issue.format === "ends_with") {
          return `\u0631\u0634\u062A\u0647 \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0628\u0627\u06CC\u062F \u0628\u0627 "${_issue.suffix}" \u062A\u0645\u0627\u0645 \u0634\u0648\u062F`;
        }
        if (_issue.format === "includes") {
          return `\u0631\u0634\u062A\u0647 \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0628\u0627\u06CC\u062F \u0634\u0627\u0645\u0644 "${_issue.includes}" \u0628\u0627\u0634\u062F`;
        }
        if (_issue.format === "regex") {
          return `\u0631\u0634\u062A\u0647 \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0628\u0627\u06CC\u062F \u0628\u0627 \u0627\u0644\u06AF\u0648\u06CC ${_issue.pattern} \u0645\u0637\u0627\u0628\u0642\u062A \u062F\u0627\u0634\u062A\u0647 \u0628\u0627\u0634\u062F`;
        }
        return `${FormatDictionary[_issue.format] ?? issue2.format} \u0646\u0627\u0645\u0639\u062A\u0628\u0631`;
      }
      case "not_multiple_of":
        return `\u0639\u062F\u062F \u0646\u0627\u0645\u0639\u062A\u0628\u0631: \u0628\u0627\u06CC\u062F \u0645\u0636\u0631\u0628 ${issue2.divisor} \u0628\u0627\u0634\u062F`;
      case "unrecognized_keys":
        return `\u06A9\u0644\u06CC\u062F${issue2.keys.length > 1 ? "\u0647\u0627\u06CC" : ""} \u0646\u0627\u0634\u0646\u0627\u0633: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u06A9\u0644\u06CC\u062F \u0646\u0627\u0634\u0646\u0627\u0633 \u062F\u0631 ${issue2.origin}`;
      case "invalid_union":
        return `\u0648\u0631\u0648\u062F\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631`;
      case "invalid_element":
        return `\u0645\u0642\u062F\u0627\u0631 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u062F\u0631 ${issue2.origin}`;
      default:
        return `\u0648\u0631\u0648\u062F\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631`;
    }
  };
};
function fa_default() {
  return {
    localeError: error13()
  };
}

// node_modules/zod/v4/locales/fi.js
var error14 = () => {
  const Sizable = {
    string: { unit: "merkki\xE4", subject: "merkkijonon" },
    file: { unit: "tavua", subject: "tiedoston" },
    array: { unit: "alkiota", subject: "listan" },
    set: { unit: "alkiota", subject: "joukon" },
    number: { unit: "", subject: "luvun" },
    bigint: { unit: "", subject: "suuren kokonaisluvun" },
    int: { unit: "", subject: "kokonaisluvun" },
    date: { unit: "", subject: "p\xE4iv\xE4m\xE4\xE4r\xE4n" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "s\xE4\xE4nn\xF6llinen lauseke",
    email: "s\xE4hk\xF6postiosoite",
    url: "URL-osoite",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-aikaleima",
    date: "ISO-p\xE4iv\xE4m\xE4\xE4r\xE4",
    time: "ISO-aika",
    duration: "ISO-kesto",
    ipv4: "IPv4-osoite",
    ipv6: "IPv6-osoite",
    cidrv4: "IPv4-alue",
    cidrv6: "IPv6-alue",
    base64: "base64-koodattu merkkijono",
    base64url: "base64url-koodattu merkkijono",
    json_string: "JSON-merkkijono",
    e164: "E.164-luku",
    jwt: "JWT",
    template_literal: "templaattimerkkijono"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Virheellinen tyyppi: odotettiin instanceof ${issue2.expected}, oli ${received}`;
        }
        return `Virheellinen tyyppi: odotettiin ${expected}, oli ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Virheellinen sy\xF6te: t\xE4ytyy olla ${stringifyPrimitive(issue2.values[0])}`;
        return `Virheellinen valinta: t\xE4ytyy olla yksi seuraavista: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Liian suuri: ${sizing.subject} t\xE4ytyy olla ${adj}${issue2.maximum.toString()} ${sizing.unit}`.trim();
        }
        return `Liian suuri: arvon t\xE4ytyy olla ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Liian pieni: ${sizing.subject} t\xE4ytyy olla ${adj}${issue2.minimum.toString()} ${sizing.unit}`.trim();
        }
        return `Liian pieni: arvon t\xE4ytyy olla ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Virheellinen sy\xF6te: t\xE4ytyy alkaa "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Virheellinen sy\xF6te: t\xE4ytyy loppua "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Virheellinen sy\xF6te: t\xE4ytyy sis\xE4lt\xE4\xE4 "${_issue.includes}"`;
        if (_issue.format === "regex") {
          return `Virheellinen sy\xF6te: t\xE4ytyy vastata s\xE4\xE4nn\xF6llist\xE4 lauseketta ${_issue.pattern}`;
        }
        return `Virheellinen ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Virheellinen luku: t\xE4ytyy olla luvun ${issue2.divisor} monikerta`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Tuntemattomat avaimet" : "Tuntematon avain"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return "Virheellinen avain tietueessa";
      case "invalid_union":
        return "Virheellinen unioni";
      case "invalid_element":
        return "Virheellinen arvo joukossa";
      default:
        return `Virheellinen sy\xF6te`;
    }
  };
};
function fi_default() {
  return {
    localeError: error14()
  };
}

// node_modules/zod/v4/locales/fr.js
var error15 = () => {
  const Sizable = {
    string: { unit: "caract\xE8res", verb: "avoir" },
    file: { unit: "octets", verb: "avoir" },
    array: { unit: "\xE9l\xE9ments", verb: "avoir" },
    set: { unit: "\xE9l\xE9ments", verb: "avoir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entr\xE9e",
    email: "adresse e-mail",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "date et heure ISO",
    date: "date ISO",
    time: "heure ISO",
    duration: "dur\xE9e ISO",
    ipv4: "adresse IPv4",
    ipv6: "adresse IPv6",
    cidrv4: "plage IPv4",
    cidrv6: "plage IPv6",
    base64: "cha\xEEne encod\xE9e en base64",
    base64url: "cha\xEEne encod\xE9e en base64url",
    json_string: "cha\xEEne JSON",
    e164: "num\xE9ro E.164",
    jwt: "JWT",
    template_literal: "entr\xE9e"
  };
  const TypeDictionary = {
    string: "cha\xEEne",
    number: "nombre",
    int: "entier",
    boolean: "bool\xE9en",
    bigint: "grand entier",
    symbol: "symbole",
    undefined: "ind\xE9fini",
    null: "null",
    never: "jamais",
    void: "vide",
    date: "date",
    array: "tableau",
    object: "objet",
    tuple: "tuple",
    record: "enregistrement",
    map: "carte",
    set: "ensemble",
    file: "fichier",
    nonoptional: "non-optionnel",
    nan: "NaN",
    function: "fonction"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Entr\xE9e invalide : instanceof ${issue2.expected} attendu, ${received} re\xE7u`;
        }
        return `Entr\xE9e invalide : ${expected} attendu, ${received} re\xE7u`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entr\xE9e invalide : ${stringifyPrimitive(issue2.values[0])} attendu`;
        return `Option invalide : une valeur parmi ${joinValues(issue2.values, "|")} attendue`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop grand : ${TypeDictionary[issue2.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\xE9l\xE9ment(s)"}`;
        return `Trop grand : ${TypeDictionary[issue2.origin] ?? "valeur"} doit \xEAtre ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop petit : ${TypeDictionary[issue2.origin] ?? "valeur"} doit ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `Trop petit : ${TypeDictionary[issue2.origin] ?? "valeur"} doit \xEAtre ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Cha\xEEne invalide : doit commencer par "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Cha\xEEne invalide : doit se terminer par "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Cha\xEEne invalide : doit inclure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Cha\xEEne invalide : doit correspondre au mod\xE8le ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} invalide`;
      }
      case "not_multiple_of":
        return `Nombre invalide : doit \xEAtre un multiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Cl\xE9${issue2.keys.length > 1 ? "s" : ""} non reconnue${issue2.keys.length > 1 ? "s" : ""} : ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Cl\xE9 invalide dans ${issue2.origin}`;
      case "invalid_union":
        return "Entr\xE9e invalide";
      case "invalid_element":
        return `Valeur invalide dans ${issue2.origin}`;
      default:
        return `Entr\xE9e invalide`;
    }
  };
};
function fr_default() {
  return {
    localeError: error15()
  };
}

// node_modules/zod/v4/locales/fr-CA.js
var error16 = () => {
  const Sizable = {
    string: { unit: "caract\xE8res", verb: "avoir" },
    file: { unit: "octets", verb: "avoir" },
    array: { unit: "\xE9l\xE9ments", verb: "avoir" },
    set: { unit: "\xE9l\xE9ments", verb: "avoir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "entr\xE9e",
    email: "adresse courriel",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "date-heure ISO",
    date: "date ISO",
    time: "heure ISO",
    duration: "dur\xE9e ISO",
    ipv4: "adresse IPv4",
    ipv6: "adresse IPv6",
    cidrv4: "plage IPv4",
    cidrv6: "plage IPv6",
    base64: "cha\xEEne encod\xE9e en base64",
    base64url: "cha\xEEne encod\xE9e en base64url",
    json_string: "cha\xEEne JSON",
    e164: "num\xE9ro E.164",
    jwt: "JWT",
    template_literal: "entr\xE9e"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Entr\xE9e invalide : attendu instanceof ${issue2.expected}, re\xE7u ${received}`;
        }
        return `Entr\xE9e invalide : attendu ${expected}, re\xE7u ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entr\xE9e invalide : attendu ${stringifyPrimitive(issue2.values[0])}`;
        return `Option invalide : attendu l'une des valeurs suivantes ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "\u2264" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop grand : attendu que ${issue2.origin ?? "la valeur"} ait ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        return `Trop grand : attendu que ${issue2.origin ?? "la valeur"} soit ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "\u2265" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Trop petit : attendu que ${issue2.origin} ait ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Trop petit : attendu que ${issue2.origin} soit ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Cha\xEEne invalide : doit commencer par "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Cha\xEEne invalide : doit se terminer par "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Cha\xEEne invalide : doit inclure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Cha\xEEne invalide : doit correspondre au motif ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} invalide`;
      }
      case "not_multiple_of":
        return `Nombre invalide : doit \xEAtre un multiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Cl\xE9${issue2.keys.length > 1 ? "s" : ""} non reconnue${issue2.keys.length > 1 ? "s" : ""} : ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Cl\xE9 invalide dans ${issue2.origin}`;
      case "invalid_union":
        return "Entr\xE9e invalide";
      case "invalid_element":
        return `Valeur invalide dans ${issue2.origin}`;
      default:
        return `Entr\xE9e invalide`;
    }
  };
};
function fr_CA_default() {
  return {
    localeError: error16()
  };
}

// node_modules/zod/v4/locales/he.js
var error17 = () => {
  const TypeNames = {
    string: { label: "\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA", gender: "f" },
    number: { label: "\u05DE\u05E1\u05E4\u05E8", gender: "m" },
    boolean: { label: "\u05E2\u05E8\u05DA \u05D1\u05D5\u05DC\u05D9\u05D0\u05E0\u05D9", gender: "m" },
    bigint: { label: "BigInt", gender: "m" },
    date: { label: "\u05EA\u05D0\u05E8\u05D9\u05DA", gender: "m" },
    array: { label: "\u05DE\u05E2\u05E8\u05DA", gender: "m" },
    object: { label: "\u05D0\u05D5\u05D1\u05D9\u05D9\u05E7\u05D8", gender: "m" },
    null: { label: "\u05E2\u05E8\u05DA \u05E8\u05D9\u05E7 (null)", gender: "m" },
    undefined: { label: "\u05E2\u05E8\u05DA \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8 (undefined)", gender: "m" },
    symbol: { label: "\u05E1\u05D9\u05DE\u05D1\u05D5\u05DC (Symbol)", gender: "m" },
    function: { label: "\u05E4\u05D5\u05E0\u05E7\u05E6\u05D9\u05D4", gender: "f" },
    map: { label: "\u05DE\u05E4\u05D4 (Map)", gender: "f" },
    set: { label: "\u05E7\u05D1\u05D5\u05E6\u05D4 (Set)", gender: "f" },
    file: { label: "\u05E7\u05D5\u05D1\u05E5", gender: "m" },
    promise: { label: "Promise", gender: "m" },
    NaN: { label: "NaN", gender: "m" },
    unknown: { label: "\u05E2\u05E8\u05DA \u05DC\u05D0 \u05D9\u05D3\u05D5\u05E2", gender: "m" },
    value: { label: "\u05E2\u05E8\u05DA", gender: "m" }
  };
  const Sizable = {
    string: { unit: "\u05EA\u05D5\u05D5\u05D9\u05DD", shortLabel: "\u05E7\u05E6\u05E8", longLabel: "\u05D0\u05E8\u05D5\u05DA" },
    file: { unit: "\u05D1\u05D9\u05D9\u05D8\u05D9\u05DD", shortLabel: "\u05E7\u05D8\u05DF", longLabel: "\u05D2\u05D3\u05D5\u05DC" },
    array: { unit: "\u05E4\u05E8\u05D9\u05D8\u05D9\u05DD", shortLabel: "\u05E7\u05D8\u05DF", longLabel: "\u05D2\u05D3\u05D5\u05DC" },
    set: { unit: "\u05E4\u05E8\u05D9\u05D8\u05D9\u05DD", shortLabel: "\u05E7\u05D8\u05DF", longLabel: "\u05D2\u05D3\u05D5\u05DC" },
    number: { unit: "", shortLabel: "\u05E7\u05D8\u05DF", longLabel: "\u05D2\u05D3\u05D5\u05DC" }
    // no unit
  };
  const typeEntry = (t) => t ? TypeNames[t] : void 0;
  const typeLabel = (t) => {
    const e = typeEntry(t);
    if (e)
      return e.label;
    return t ?? TypeNames.unknown.label;
  };
  const withDefinite = (t) => `\u05D4${typeLabel(t)}`;
  const verbFor = (t) => {
    const e = typeEntry(t);
    const gender = e?.gender ?? "m";
    return gender === "f" ? "\u05E6\u05E8\u05D9\u05DB\u05D4 \u05DC\u05D4\u05D9\u05D5\u05EA" : "\u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05D9\u05D5\u05EA";
  };
  const getSizing = (origin) => {
    if (!origin)
      return null;
    return Sizable[origin] ?? null;
  };
  const FormatDictionary = {
    regex: { label: "\u05E7\u05DC\u05D8", gender: "m" },
    email: { label: "\u05DB\u05EA\u05D5\u05D1\u05EA \u05D0\u05D9\u05DE\u05D9\u05D9\u05DC", gender: "f" },
    url: { label: "\u05DB\u05EA\u05D5\u05D1\u05EA \u05E8\u05E9\u05EA", gender: "f" },
    emoji: { label: "\u05D0\u05D9\u05DE\u05D5\u05D2'\u05D9", gender: "m" },
    uuid: { label: "UUID", gender: "m" },
    nanoid: { label: "nanoid", gender: "m" },
    guid: { label: "GUID", gender: "m" },
    cuid: { label: "cuid", gender: "m" },
    cuid2: { label: "cuid2", gender: "m" },
    ulid: { label: "ULID", gender: "m" },
    xid: { label: "XID", gender: "m" },
    ksuid: { label: "KSUID", gender: "m" },
    datetime: { label: "\u05EA\u05D0\u05E8\u05D9\u05DA \u05D5\u05D6\u05DE\u05DF ISO", gender: "m" },
    date: { label: "\u05EA\u05D0\u05E8\u05D9\u05DA ISO", gender: "m" },
    time: { label: "\u05D6\u05DE\u05DF ISO", gender: "m" },
    duration: { label: "\u05DE\u05E9\u05DA \u05D6\u05DE\u05DF ISO", gender: "m" },
    ipv4: { label: "\u05DB\u05EA\u05D5\u05D1\u05EA IPv4", gender: "f" },
    ipv6: { label: "\u05DB\u05EA\u05D5\u05D1\u05EA IPv6", gender: "f" },
    cidrv4: { label: "\u05D8\u05D5\u05D5\u05D7 IPv4", gender: "m" },
    cidrv6: { label: "\u05D8\u05D5\u05D5\u05D7 IPv6", gender: "m" },
    base64: { label: "\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05D1\u05D1\u05E1\u05D9\u05E1 64", gender: "f" },
    base64url: { label: "\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05D1\u05D1\u05E1\u05D9\u05E1 64 \u05DC\u05DB\u05EA\u05D5\u05D1\u05D5\u05EA \u05E8\u05E9\u05EA", gender: "f" },
    json_string: { label: "\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA JSON", gender: "f" },
    e164: { label: "\u05DE\u05E1\u05E4\u05E8 E.164", gender: "m" },
    jwt: { label: "JWT", gender: "m" },
    ends_with: { label: "\u05E7\u05DC\u05D8", gender: "m" },
    includes: { label: "\u05E7\u05DC\u05D8", gender: "m" },
    lowercase: { label: "\u05E7\u05DC\u05D8", gender: "m" },
    starts_with: { label: "\u05E7\u05DC\u05D8", gender: "m" },
    uppercase: { label: "\u05E7\u05DC\u05D8", gender: "m" }
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expectedKey = issue2.expected;
        const expected = TypeDictionary[expectedKey ?? ""] ?? typeLabel(expectedKey);
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? TypeNames[receivedType]?.label ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u05E7\u05DC\u05D8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF: \u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05D9\u05D5\u05EA instanceof ${issue2.expected}, \u05D4\u05EA\u05E7\u05D1\u05DC ${received}`;
        }
        return `\u05E7\u05DC\u05D8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF: \u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05D9\u05D5\u05EA ${expected}, \u05D4\u05EA\u05E7\u05D1\u05DC ${received}`;
      }
      case "invalid_value": {
        if (issue2.values.length === 1) {
          return `\u05E2\u05E8\u05DA \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF: \u05D4\u05E2\u05E8\u05DA \u05D7\u05D9\u05D9\u05D1 \u05DC\u05D4\u05D9\u05D5\u05EA ${stringifyPrimitive(issue2.values[0])}`;
        }
        const stringified = issue2.values.map((v) => stringifyPrimitive(v));
        if (issue2.values.length === 2) {
          return `\u05E2\u05E8\u05DA \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF: \u05D4\u05D0\u05E4\u05E9\u05E8\u05D5\u05D9\u05D5\u05EA \u05D4\u05DE\u05EA\u05D0\u05D9\u05DE\u05D5\u05EA \u05D4\u05DF ${stringified[0]} \u05D0\u05D5 ${stringified[1]}`;
        }
        const lastValue = stringified[stringified.length - 1];
        const restValues = stringified.slice(0, -1).join(", ");
        return `\u05E2\u05E8\u05DA \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF: \u05D4\u05D0\u05E4\u05E9\u05E8\u05D5\u05D9\u05D5\u05EA \u05D4\u05DE\u05EA\u05D0\u05D9\u05DE\u05D5\u05EA \u05D4\u05DF ${restValues} \u05D0\u05D5 ${lastValue}`;
      }
      case "too_big": {
        const sizing = getSizing(issue2.origin);
        const subject = withDefinite(issue2.origin ?? "value");
        if (issue2.origin === "string") {
          return `${sizing?.longLabel ?? "\u05D0\u05E8\u05D5\u05DA"} \u05DE\u05D3\u05D9: ${subject} \u05E6\u05E8\u05D9\u05DB\u05D4 \u05DC\u05D4\u05DB\u05D9\u05DC ${issue2.maximum.toString()} ${sizing?.unit ?? ""} ${issue2.inclusive ? "\u05D0\u05D5 \u05E4\u05D7\u05D5\u05EA" : "\u05DC\u05DB\u05DC \u05D4\u05D9\u05D5\u05EA\u05E8"}`.trim();
        }
        if (issue2.origin === "number") {
          const comparison = issue2.inclusive ? `\u05E7\u05D8\u05DF \u05D0\u05D5 \u05E9\u05D5\u05D5\u05D4 \u05DC-${issue2.maximum}` : `\u05E7\u05D8\u05DF \u05DE-${issue2.maximum}`;
          return `\u05D2\u05D3\u05D5\u05DC \u05DE\u05D3\u05D9: ${subject} \u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05D9\u05D5\u05EA ${comparison}`;
        }
        if (issue2.origin === "array" || issue2.origin === "set") {
          const verb = issue2.origin === "set" ? "\u05E6\u05E8\u05D9\u05DB\u05D4" : "\u05E6\u05E8\u05D9\u05DA";
          const comparison = issue2.inclusive ? `${issue2.maximum} ${sizing?.unit ?? ""} \u05D0\u05D5 \u05E4\u05D7\u05D5\u05EA` : `\u05E4\u05D7\u05D5\u05EA \u05DE-${issue2.maximum} ${sizing?.unit ?? ""}`;
          return `\u05D2\u05D3\u05D5\u05DC \u05DE\u05D3\u05D9: ${subject} ${verb} \u05DC\u05D4\u05DB\u05D9\u05DC ${comparison}`.trim();
        }
        const adj = issue2.inclusive ? "<=" : "<";
        const be = verbFor(issue2.origin ?? "value");
        if (sizing?.unit) {
          return `${sizing.longLabel} \u05DE\u05D3\u05D9: ${subject} ${be} ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        }
        return `${sizing?.longLabel ?? "\u05D2\u05D3\u05D5\u05DC"} \u05DE\u05D3\u05D9: ${subject} ${be} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const sizing = getSizing(issue2.origin);
        const subject = withDefinite(issue2.origin ?? "value");
        if (issue2.origin === "string") {
          return `${sizing?.shortLabel ?? "\u05E7\u05E6\u05E8"} \u05DE\u05D3\u05D9: ${subject} \u05E6\u05E8\u05D9\u05DB\u05D4 \u05DC\u05D4\u05DB\u05D9\u05DC ${issue2.minimum.toString()} ${sizing?.unit ?? ""} ${issue2.inclusive ? "\u05D0\u05D5 \u05D9\u05D5\u05EA\u05E8" : "\u05DC\u05E4\u05D7\u05D5\u05EA"}`.trim();
        }
        if (issue2.origin === "number") {
          const comparison = issue2.inclusive ? `\u05D2\u05D3\u05D5\u05DC \u05D0\u05D5 \u05E9\u05D5\u05D5\u05D4 \u05DC-${issue2.minimum}` : `\u05D2\u05D3\u05D5\u05DC \u05DE-${issue2.minimum}`;
          return `\u05E7\u05D8\u05DF \u05DE\u05D3\u05D9: ${subject} \u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05D9\u05D5\u05EA ${comparison}`;
        }
        if (issue2.origin === "array" || issue2.origin === "set") {
          const verb = issue2.origin === "set" ? "\u05E6\u05E8\u05D9\u05DB\u05D4" : "\u05E6\u05E8\u05D9\u05DA";
          if (issue2.minimum === 1 && issue2.inclusive) {
            const singularPhrase = issue2.origin === "set" ? "\u05DC\u05E4\u05D7\u05D5\u05EA \u05E4\u05E8\u05D9\u05D8 \u05D0\u05D7\u05D3" : "\u05DC\u05E4\u05D7\u05D5\u05EA \u05E4\u05E8\u05D9\u05D8 \u05D0\u05D7\u05D3";
            return `\u05E7\u05D8\u05DF \u05DE\u05D3\u05D9: ${subject} ${verb} \u05DC\u05D4\u05DB\u05D9\u05DC ${singularPhrase}`;
          }
          const comparison = issue2.inclusive ? `${issue2.minimum} ${sizing?.unit ?? ""} \u05D0\u05D5 \u05D9\u05D5\u05EA\u05E8` : `\u05D9\u05D5\u05EA\u05E8 \u05DE-${issue2.minimum} ${sizing?.unit ?? ""}`;
          return `\u05E7\u05D8\u05DF \u05DE\u05D3\u05D9: ${subject} ${verb} \u05DC\u05D4\u05DB\u05D9\u05DC ${comparison}`.trim();
        }
        const adj = issue2.inclusive ? ">=" : ">";
        const be = verbFor(issue2.origin ?? "value");
        if (sizing?.unit) {
          return `${sizing.shortLabel} \u05DE\u05D3\u05D9: ${subject} ${be} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `${sizing?.shortLabel ?? "\u05E7\u05D8\u05DF"} \u05DE\u05D3\u05D9: ${subject} ${be} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u05D4\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05D7\u05D9\u05D9\u05D1\u05EA \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05D1 "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `\u05D4\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05D7\u05D9\u05D9\u05D1\u05EA \u05DC\u05D4\u05E1\u05EA\u05D9\u05D9\u05DD \u05D1 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u05D4\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05D7\u05D9\u05D9\u05D1\u05EA \u05DC\u05DB\u05DC\u05D5\u05DC "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u05D4\u05DE\u05D7\u05E8\u05D5\u05D6\u05EA \u05D7\u05D9\u05D9\u05D1\u05EA \u05DC\u05D4\u05EA\u05D0\u05D9\u05DD \u05DC\u05EA\u05D1\u05E0\u05D9\u05EA ${_issue.pattern}`;
        const nounEntry = FormatDictionary[_issue.format];
        const noun = nounEntry?.label ?? _issue.format;
        const gender = nounEntry?.gender ?? "m";
        const adjective = gender === "f" ? "\u05EA\u05E7\u05D9\u05E0\u05D4" : "\u05EA\u05E7\u05D9\u05DF";
        return `${noun} \u05DC\u05D0 ${adjective}`;
      }
      case "not_multiple_of":
        return `\u05DE\u05E1\u05E4\u05E8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF: \u05D7\u05D9\u05D9\u05D1 \u05DC\u05D4\u05D9\u05D5\u05EA \u05DE\u05DB\u05E4\u05DC\u05D4 \u05E9\u05DC ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u05DE\u05E4\u05EA\u05D7${issue2.keys.length > 1 ? "\u05D5\u05EA" : ""} \u05DC\u05D0 \u05DE\u05D6\u05D5\u05D4${issue2.keys.length > 1 ? "\u05D9\u05DD" : "\u05D4"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key": {
        return `\u05E9\u05D3\u05D4 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF \u05D1\u05D0\u05D5\u05D1\u05D9\u05D9\u05E7\u05D8`;
      }
      case "invalid_union":
        return "\u05E7\u05DC\u05D8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF";
      case "invalid_element": {
        const place = withDefinite(issue2.origin ?? "array");
        return `\u05E2\u05E8\u05DA \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF \u05D1${place}`;
      }
      default:
        return `\u05E7\u05DC\u05D8 \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF`;
    }
  };
};
function he_default() {
  return {
    localeError: error17()
  };
}

// node_modules/zod/v4/locales/hr.js
var error18 = () => {
  const Sizable = {
    string: { unit: "znakova", verb: "imati" },
    file: { unit: "bajtova", verb: "imati" },
    array: { unit: "stavki", verb: "imati" },
    set: { unit: "stavki", verb: "imati" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "unos",
    email: "email adresa",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum i vrijeme",
    date: "ISO datum",
    time: "ISO vrijeme",
    duration: "ISO trajanje",
    ipv4: "IPv4 adresa",
    ipv6: "IPv6 adresa",
    cidrv4: "IPv4 raspon",
    cidrv6: "IPv6 raspon",
    base64: "base64 kodirani tekst",
    base64url: "base64url kodirani tekst",
    json_string: "JSON tekst",
    e164: "E.164 broj",
    jwt: "JWT",
    template_literal: "unos"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "tekst",
    number: "broj",
    boolean: "boolean",
    array: "niz",
    object: "objekt",
    set: "skup",
    file: "datoteka",
    date: "datum",
    bigint: "bigint",
    symbol: "simbol",
    undefined: "undefined",
    null: "null",
    function: "funkcija",
    map: "mapa"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Neispravan unos: o\u010Dekuje se instanceof ${issue2.expected}, a primljeno je ${received}`;
        }
        return `Neispravan unos: o\u010Dekuje se ${expected}, a primljeno je ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neispravna vrijednost: o\u010Dekivano ${stringifyPrimitive(issue2.values[0])}`;
        return `Neispravna opcija: o\u010Dekivano jedno od ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing)
          return `Preveliko: o\u010Dekivano da ${origin ?? "vrijednost"} ima ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemenata"}`;
        return `Preveliko: o\u010Dekivano da ${origin ?? "vrijednost"} bude ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        if (sizing) {
          return `Premalo: o\u010Dekivano da ${origin} ima ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Premalo: o\u010Dekivano da ${origin} bude ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Neispravan tekst: mora zapo\u010Dinjati s "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Neispravan tekst: mora zavr\u0161avati s "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neispravan tekst: mora sadr\u017Eavati "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neispravan tekst: mora odgovarati uzorku ${_issue.pattern}`;
        return `Neispravna ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neispravan broj: mora biti vi\u0161ekratnik od ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Neprepoznat${issue2.keys.length > 1 ? "i klju\u010Devi" : " klju\u010D"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neispravan klju\u010D u ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      case "invalid_union":
        return "Neispravan unos";
      case "invalid_element":
        return `Neispravna vrijednost u ${TypeDictionary[issue2.origin] ?? issue2.origin}`;
      default:
        return `Neispravan unos`;
    }
  };
};
function hr_default() {
  return {
    localeError: error18()
  };
}

// node_modules/zod/v4/locales/hu.js
var error19 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "legyen" },
    file: { unit: "byte", verb: "legyen" },
    array: { unit: "elem", verb: "legyen" },
    set: { unit: "elem", verb: "legyen" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "bemenet",
    email: "email c\xEDm",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO id\u0151b\xE9lyeg",
    date: "ISO d\xE1tum",
    time: "ISO id\u0151",
    duration: "ISO id\u0151intervallum",
    ipv4: "IPv4 c\xEDm",
    ipv6: "IPv6 c\xEDm",
    cidrv4: "IPv4 tartom\xE1ny",
    cidrv6: "IPv6 tartom\xE1ny",
    base64: "base64-k\xF3dolt string",
    base64url: "base64url-k\xF3dolt string",
    json_string: "JSON string",
    e164: "E.164 sz\xE1m",
    jwt: "JWT",
    template_literal: "bemenet"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "sz\xE1m",
    array: "t\xF6mb"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\xC9rv\xE9nytelen bemenet: a v\xE1rt \xE9rt\xE9k instanceof ${issue2.expected}, a kapott \xE9rt\xE9k ${received}`;
        }
        return `\xC9rv\xE9nytelen bemenet: a v\xE1rt \xE9rt\xE9k ${expected}, a kapott \xE9rt\xE9k ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\xC9rv\xE9nytelen bemenet: a v\xE1rt \xE9rt\xE9k ${stringifyPrimitive(issue2.values[0])}`;
        return `\xC9rv\xE9nytelen opci\xF3: valamelyik \xE9rt\xE9k v\xE1rt ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `T\xFAl nagy: ${issue2.origin ?? "\xE9rt\xE9k"} m\xE9rete t\xFAl nagy ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elem"}`;
        return `T\xFAl nagy: a bemeneti \xE9rt\xE9k ${issue2.origin ?? "\xE9rt\xE9k"} t\xFAl nagy: ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `T\xFAl kicsi: a bemeneti \xE9rt\xE9k ${issue2.origin} m\xE9rete t\xFAl kicsi ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `T\xFAl kicsi: a bemeneti \xE9rt\xE9k ${issue2.origin} t\xFAl kicsi ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\xC9rv\xE9nytelen string: "${_issue.prefix}" \xE9rt\xE9kkel kell kezd\u0151dnie`;
        if (_issue.format === "ends_with")
          return `\xC9rv\xE9nytelen string: "${_issue.suffix}" \xE9rt\xE9kkel kell v\xE9gz\u0151dnie`;
        if (_issue.format === "includes")
          return `\xC9rv\xE9nytelen string: "${_issue.includes}" \xE9rt\xE9ket kell tartalmaznia`;
        if (_issue.format === "regex")
          return `\xC9rv\xE9nytelen string: ${_issue.pattern} mint\xE1nak kell megfelelnie`;
        return `\xC9rv\xE9nytelen ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\xC9rv\xE9nytelen sz\xE1m: ${issue2.divisor} t\xF6bbsz\xF6r\xF6s\xE9nek kell lennie`;
      case "unrecognized_keys":
        return `Ismeretlen kulcs${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\xC9rv\xE9nytelen kulcs ${issue2.origin}`;
      case "invalid_union":
        return "\xC9rv\xE9nytelen bemenet";
      case "invalid_element":
        return `\xC9rv\xE9nytelen \xE9rt\xE9k: ${issue2.origin}`;
      default:
        return `\xC9rv\xE9nytelen bemenet`;
    }
  };
};
function hu_default() {
  return {
    localeError: error19()
  };
}

// node_modules/zod/v4/locales/hy.js
function getArmenianPlural(count, one, many) {
  return Math.abs(count) === 1 ? one : many;
}
function withDefiniteArticle(word) {
  if (!word)
    return "";
  const vowels = ["\u0561", "\u0565", "\u0568", "\u056B", "\u0578", "\u0578\u0582", "\u0585"];
  const lastChar = word[word.length - 1];
  return word + (vowels.includes(lastChar) ? "\u0576" : "\u0568");
}
var error20 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "\u0576\u0577\u0561\u0576",
        many: "\u0576\u0577\u0561\u0576\u0576\u0565\u0580"
      },
      verb: "\u0578\u0582\u0576\u0565\u0576\u0561\u056C"
    },
    file: {
      unit: {
        one: "\u0562\u0561\u0575\u0569",
        many: "\u0562\u0561\u0575\u0569\u0565\u0580"
      },
      verb: "\u0578\u0582\u0576\u0565\u0576\u0561\u056C"
    },
    array: {
      unit: {
        one: "\u057F\u0561\u0580\u0580",
        many: "\u057F\u0561\u0580\u0580\u0565\u0580"
      },
      verb: "\u0578\u0582\u0576\u0565\u0576\u0561\u056C"
    },
    set: {
      unit: {
        one: "\u057F\u0561\u0580\u0580",
        many: "\u057F\u0561\u0580\u0580\u0565\u0580"
      },
      verb: "\u0578\u0582\u0576\u0565\u0576\u0561\u056C"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0574\u0578\u0582\u057F\u0584",
    email: "\u0567\u056C. \u0570\u0561\u057D\u0581\u0565",
    url: "URL",
    emoji: "\u0567\u0574\u0578\u057B\u056B",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u0561\u0574\u057D\u0561\u0569\u056B\u057E \u0587 \u056A\u0561\u0574",
    date: "ISO \u0561\u0574\u057D\u0561\u0569\u056B\u057E",
    time: "ISO \u056A\u0561\u0574",
    duration: "ISO \u057F\u0587\u0578\u0572\u0578\u0582\u0569\u0575\u0578\u0582\u0576",
    ipv4: "IPv4 \u0570\u0561\u057D\u0581\u0565",
    ipv6: "IPv6 \u0570\u0561\u057D\u0581\u0565",
    cidrv4: "IPv4 \u0574\u056B\u057B\u0561\u056F\u0561\u0575\u0584",
    cidrv6: "IPv6 \u0574\u056B\u057B\u0561\u056F\u0561\u0575\u0584",
    base64: "base64 \u0571\u0587\u0561\u0579\u0561\u0583\u0578\u057E \u057F\u0578\u0572",
    base64url: "base64url \u0571\u0587\u0561\u0579\u0561\u0583\u0578\u057E \u057F\u0578\u0572",
    json_string: "JSON \u057F\u0578\u0572",
    e164: "E.164 \u0570\u0561\u0574\u0561\u0580",
    jwt: "JWT",
    template_literal: "\u0574\u0578\u0582\u057F\u0584"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0569\u056B\u057E",
    array: "\u0566\u0561\u0576\u0563\u057E\u0561\u056E"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u054D\u056D\u0561\u056C \u0574\u0578\u0582\u057F\u0584\u0561\u0563\u0580\u0578\u0582\u0574\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567\u0580 instanceof ${issue2.expected}, \u057D\u057F\u0561\u0581\u057E\u0565\u056C \u0567 ${received}`;
        }
        return `\u054D\u056D\u0561\u056C \u0574\u0578\u0582\u057F\u0584\u0561\u0563\u0580\u0578\u0582\u0574\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567\u0580 ${expected}, \u057D\u057F\u0561\u0581\u057E\u0565\u056C \u0567 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u054D\u056D\u0561\u056C \u0574\u0578\u0582\u057F\u0584\u0561\u0563\u0580\u0578\u0582\u0574\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567\u0580 ${stringifyPrimitive(issue2.values[1])}`;
        return `\u054D\u056D\u0561\u056C \u057F\u0561\u0580\u0562\u0565\u0580\u0561\u056F\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567\u0580 \u0570\u0565\u057F\u0587\u0575\u0561\u056C\u0576\u0565\u0580\u056B\u0581 \u0574\u0565\u056F\u0568\u055D ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getArmenianPlural(maxValue, sizing.unit.one, sizing.unit.many);
          return `\u0549\u0561\u0583\u0561\u0566\u0561\u0576\u0581 \u0574\u0565\u056E \u0561\u0580\u056A\u0565\u0584\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567, \u0578\u0580 ${withDefiniteArticle(issue2.origin ?? "\u0561\u0580\u056A\u0565\u0584")} \u056F\u0578\u0582\u0576\u0565\u0576\u0561 ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `\u0549\u0561\u0583\u0561\u0566\u0561\u0576\u0581 \u0574\u0565\u056E \u0561\u0580\u056A\u0565\u0584\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567, \u0578\u0580 ${withDefiniteArticle(issue2.origin ?? "\u0561\u0580\u056A\u0565\u0584")} \u056C\u056B\u0576\u056B ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getArmenianPlural(minValue, sizing.unit.one, sizing.unit.many);
          return `\u0549\u0561\u0583\u0561\u0566\u0561\u0576\u0581 \u0583\u0578\u0584\u0580 \u0561\u0580\u056A\u0565\u0584\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567, \u0578\u0580 ${withDefiniteArticle(issue2.origin)} \u056F\u0578\u0582\u0576\u0565\u0576\u0561 ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `\u0549\u0561\u0583\u0561\u0566\u0561\u0576\u0581 \u0583\u0578\u0584\u0580 \u0561\u0580\u056A\u0565\u0584\u2024 \u057D\u057A\u0561\u057D\u057E\u0578\u0582\u0574 \u0567, \u0578\u0580 ${withDefiniteArticle(issue2.origin)} \u056C\u056B\u0576\u056B ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u054D\u056D\u0561\u056C \u057F\u0578\u0572\u2024 \u057A\u0565\u057F\u0584 \u0567 \u057D\u056F\u057D\u057E\u056B "${_issue.prefix}"-\u0578\u057E`;
        if (_issue.format === "ends_with")
          return `\u054D\u056D\u0561\u056C \u057F\u0578\u0572\u2024 \u057A\u0565\u057F\u0584 \u0567 \u0561\u057E\u0561\u0580\u057F\u057E\u056B "${_issue.suffix}"-\u0578\u057E`;
        if (_issue.format === "includes")
          return `\u054D\u056D\u0561\u056C \u057F\u0578\u0572\u2024 \u057A\u0565\u057F\u0584 \u0567 \u057A\u0561\u0580\u0578\u0582\u0576\u0561\u056F\u056B "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u054D\u056D\u0561\u056C \u057F\u0578\u0572\u2024 \u057A\u0565\u057F\u0584 \u0567 \u0570\u0561\u0574\u0561\u057A\u0561\u057F\u0561\u057D\u056D\u0561\u0576\u056B ${_issue.pattern} \u0571\u0587\u0561\u0579\u0561\u0583\u056B\u0576`;
        return `\u054D\u056D\u0561\u056C ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u054D\u056D\u0561\u056C \u0569\u056B\u057E\u2024 \u057A\u0565\u057F\u0584 \u0567 \u0562\u0561\u0566\u0574\u0561\u057A\u0561\u057F\u056B\u056F \u056C\u056B\u0576\u056B ${issue2.divisor}-\u056B`;
      case "unrecognized_keys":
        return `\u0549\u0573\u0561\u0576\u0561\u0579\u057E\u0561\u056E \u0562\u0561\u0576\u0561\u056C\u056B${issue2.keys.length > 1 ? "\u0576\u0565\u0580" : ""}. ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u054D\u056D\u0561\u056C \u0562\u0561\u0576\u0561\u056C\u056B ${withDefiniteArticle(issue2.origin)}-\u0578\u0582\u0574`;
      case "invalid_union":
        return "\u054D\u056D\u0561\u056C \u0574\u0578\u0582\u057F\u0584\u0561\u0563\u0580\u0578\u0582\u0574";
      case "invalid_element":
        return `\u054D\u056D\u0561\u056C \u0561\u0580\u056A\u0565\u0584 ${withDefiniteArticle(issue2.origin)}-\u0578\u0582\u0574`;
      default:
        return `\u054D\u056D\u0561\u056C \u0574\u0578\u0582\u057F\u0584\u0561\u0563\u0580\u0578\u0582\u0574`;
    }
  };
};
function hy_default() {
  return {
    localeError: error20()
  };
}

// node_modules/zod/v4/locales/id.js
var error21 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "memiliki" },
    file: { unit: "byte", verb: "memiliki" },
    array: { unit: "item", verb: "memiliki" },
    set: { unit: "item", verb: "memiliki" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "alamat email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "tanggal dan waktu format ISO",
    date: "tanggal format ISO",
    time: "jam format ISO",
    duration: "durasi format ISO",
    ipv4: "alamat IPv4",
    ipv6: "alamat IPv6",
    cidrv4: "rentang alamat IPv4",
    cidrv6: "rentang alamat IPv6",
    base64: "string dengan enkode base64",
    base64url: "string dengan enkode base64url",
    json_string: "string JSON",
    e164: "angka E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Input tidak valid: diharapkan instanceof ${issue2.expected}, diterima ${received}`;
        }
        return `Input tidak valid: diharapkan ${expected}, diterima ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input tidak valid: diharapkan ${stringifyPrimitive(issue2.values[0])}`;
        return `Pilihan tidak valid: diharapkan salah satu dari ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Terlalu besar: diharapkan ${issue2.origin ?? "value"} memiliki ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemen"}`;
        return `Terlalu besar: diharapkan ${issue2.origin ?? "value"} menjadi ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Terlalu kecil: diharapkan ${issue2.origin} memiliki ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Terlalu kecil: diharapkan ${issue2.origin} menjadi ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `String tidak valid: harus dimulai dengan "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `String tidak valid: harus berakhir dengan "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `String tidak valid: harus menyertakan "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `String tidak valid: harus sesuai pola ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} tidak valid`;
      }
      case "not_multiple_of":
        return `Angka tidak valid: harus kelipatan dari ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Kunci tidak dikenali ${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Kunci tidak valid di ${issue2.origin}`;
      case "invalid_union":
        return "Input tidak valid";
      case "invalid_element":
        return `Nilai tidak valid di ${issue2.origin}`;
      default:
        return `Input tidak valid`;
    }
  };
};
function id_default() {
  return {
    localeError: error21()
  };
}

// node_modules/zod/v4/locales/is.js
var error22 = () => {
  const Sizable = {
    string: { unit: "stafi", verb: "a\xF0 hafa" },
    file: { unit: "b\xE6ti", verb: "a\xF0 hafa" },
    array: { unit: "hluti", verb: "a\xF0 hafa" },
    set: { unit: "hluti", verb: "a\xF0 hafa" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "gildi",
    email: "netfang",
    url: "vefsl\xF3\xF0",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dagsetning og t\xEDmi",
    date: "ISO dagsetning",
    time: "ISO t\xEDmi",
    duration: "ISO t\xEDmalengd",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded strengur",
    base64url: "base64url-encoded strengur",
    json_string: "JSON strengur",
    e164: "E.164 t\xF6lugildi",
    jwt: "JWT",
    template_literal: "gildi"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "n\xFAmer",
    array: "fylki"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Rangt gildi: \xDE\xFA sl\xF3st inn ${received} \xFEar sem \xE1 a\xF0 vera instanceof ${issue2.expected}`;
        }
        return `Rangt gildi: \xDE\xFA sl\xF3st inn ${received} \xFEar sem \xE1 a\xF0 vera ${expected}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Rangt gildi: gert r\xE1\xF0 fyrir ${stringifyPrimitive(issue2.values[0])}`;
        return `\xD3gilt val: m\xE1 vera eitt af eftirfarandi ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Of st\xF3rt: gert er r\xE1\xF0 fyrir a\xF0 ${issue2.origin ?? "gildi"} hafi ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "hluti"}`;
        return `Of st\xF3rt: gert er r\xE1\xF0 fyrir a\xF0 ${issue2.origin ?? "gildi"} s\xE9 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Of l\xEDti\xF0: gert er r\xE1\xF0 fyrir a\xF0 ${issue2.origin} hafi ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Of l\xEDti\xF0: gert er r\xE1\xF0 fyrir a\xF0 ${issue2.origin} s\xE9 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\xD3gildur strengur: ver\xF0ur a\xF0 byrja \xE1 "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `\xD3gildur strengur: ver\xF0ur a\xF0 enda \xE1 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\xD3gildur strengur: ver\xF0ur a\xF0 innihalda "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\xD3gildur strengur: ver\xF0ur a\xF0 fylgja mynstri ${_issue.pattern}`;
        return `Rangt ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `R\xF6ng tala: ver\xF0ur a\xF0 vera margfeldi af ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\xD3\xFEekkt ${issue2.keys.length > 1 ? "ir lyklar" : "ur lykill"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Rangur lykill \xED ${issue2.origin}`;
      case "invalid_union":
        return "Rangt gildi";
      case "invalid_element":
        return `Rangt gildi \xED ${issue2.origin}`;
      default:
        return `Rangt gildi`;
    }
  };
};
function is_default() {
  return {
    localeError: error22()
  };
}

// node_modules/zod/v4/locales/it.js
var error23 = () => {
  const Sizable = {
    string: { unit: "caratteri", verb: "avere" },
    file: { unit: "byte", verb: "avere" },
    array: { unit: "elementi", verb: "avere" },
    set: { unit: "elementi", verb: "avere" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "indirizzo email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data e ora ISO",
    date: "data ISO",
    time: "ora ISO",
    duration: "durata ISO",
    ipv4: "indirizzo IPv4",
    ipv6: "indirizzo IPv6",
    cidrv4: "intervallo IPv4",
    cidrv6: "intervallo IPv6",
    base64: "stringa codificata in base64",
    base64url: "URL codificata in base64",
    json_string: "stringa JSON",
    e164: "numero E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "numero",
    array: "vettore"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Input non valido: atteso instanceof ${issue2.expected}, ricevuto ${received}`;
        }
        return `Input non valido: atteso ${expected}, ricevuto ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input non valido: atteso ${stringifyPrimitive(issue2.values[0])}`;
        return `Opzione non valida: atteso uno tra ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Troppo grande: ${issue2.origin ?? "valore"} deve avere ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementi"}`;
        return `Troppo grande: ${issue2.origin ?? "valore"} deve essere ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Troppo piccolo: ${issue2.origin} deve avere ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Troppo piccolo: ${issue2.origin} deve essere ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Stringa non valida: deve iniziare con "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Stringa non valida: deve terminare con "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Stringa non valida: deve includere "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Stringa non valida: deve corrispondere al pattern ${_issue.pattern}`;
        return `Input non valido: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Numero non valido: deve essere un multiplo di ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chiav${issue2.keys.length > 1 ? "i" : "e"} non riconosciut${issue2.keys.length > 1 ? "e" : "a"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Chiave non valida in ${issue2.origin}`;
      case "invalid_union":
        return "Input non valido";
      case "invalid_element":
        return `Valore non valido in ${issue2.origin}`;
      default:
        return `Input non valido`;
    }
  };
};
function it_default() {
  return {
    localeError: error23()
  };
}

// node_modules/zod/v4/locales/ja.js
var error24 = () => {
  const Sizable = {
    string: { unit: "\u6587\u5B57", verb: "\u3067\u3042\u308B" },
    file: { unit: "\u30D0\u30A4\u30C8", verb: "\u3067\u3042\u308B" },
    array: { unit: "\u8981\u7D20", verb: "\u3067\u3042\u308B" },
    set: { unit: "\u8981\u7D20", verb: "\u3067\u3042\u308B" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u5165\u529B\u5024",
    email: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9",
    url: "URL",
    emoji: "\u7D75\u6587\u5B57",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO\u65E5\u6642",
    date: "ISO\u65E5\u4ED8",
    time: "ISO\u6642\u523B",
    duration: "ISO\u671F\u9593",
    ipv4: "IPv4\u30A2\u30C9\u30EC\u30B9",
    ipv6: "IPv6\u30A2\u30C9\u30EC\u30B9",
    cidrv4: "IPv4\u7BC4\u56F2",
    cidrv6: "IPv6\u7BC4\u56F2",
    base64: "base64\u30A8\u30F3\u30B3\u30FC\u30C9\u6587\u5B57\u5217",
    base64url: "base64url\u30A8\u30F3\u30B3\u30FC\u30C9\u6587\u5B57\u5217",
    json_string: "JSON\u6587\u5B57\u5217",
    e164: "E.164\u756A\u53F7",
    jwt: "JWT",
    template_literal: "\u5165\u529B\u5024"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u6570\u5024",
    array: "\u914D\u5217"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u7121\u52B9\u306A\u5165\u529B: instanceof ${issue2.expected}\u304C\u671F\u5F85\u3055\u308C\u307E\u3057\u305F\u304C\u3001${received}\u304C\u5165\u529B\u3055\u308C\u307E\u3057\u305F`;
        }
        return `\u7121\u52B9\u306A\u5165\u529B: ${expected}\u304C\u671F\u5F85\u3055\u308C\u307E\u3057\u305F\u304C\u3001${received}\u304C\u5165\u529B\u3055\u308C\u307E\u3057\u305F`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u7121\u52B9\u306A\u5165\u529B: ${stringifyPrimitive(issue2.values[0])}\u304C\u671F\u5F85\u3055\u308C\u307E\u3057\u305F`;
        return `\u7121\u52B9\u306A\u9078\u629E: ${joinValues(issue2.values, "\u3001")}\u306E\u3044\u305A\u308C\u304B\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
      case "too_big": {
        const adj = issue2.inclusive ? "\u4EE5\u4E0B\u3067\u3042\u308B" : "\u3088\u308A\u5C0F\u3055\u3044";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u5927\u304D\u3059\u304E\u308B\u5024: ${issue2.origin ?? "\u5024"}\u306F${issue2.maximum.toString()}${sizing.unit ?? "\u8981\u7D20"}${adj}\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
        return `\u5927\u304D\u3059\u304E\u308B\u5024: ${issue2.origin ?? "\u5024"}\u306F${issue2.maximum.toString()}${adj}\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "\u4EE5\u4E0A\u3067\u3042\u308B" : "\u3088\u308A\u5927\u304D\u3044";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u5C0F\u3055\u3059\u304E\u308B\u5024: ${issue2.origin}\u306F${issue2.minimum.toString()}${sizing.unit}${adj}\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
        return `\u5C0F\u3055\u3059\u304E\u308B\u5024: ${issue2.origin}\u306F${issue2.minimum.toString()}${adj}\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u7121\u52B9\u306A\u6587\u5B57\u5217: "${_issue.prefix}"\u3067\u59CB\u307E\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
        if (_issue.format === "ends_with")
          return `\u7121\u52B9\u306A\u6587\u5B57\u5217: "${_issue.suffix}"\u3067\u7D42\u308F\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
        if (_issue.format === "includes")
          return `\u7121\u52B9\u306A\u6587\u5B57\u5217: "${_issue.includes}"\u3092\u542B\u3080\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
        if (_issue.format === "regex")
          return `\u7121\u52B9\u306A\u6587\u5B57\u5217: \u30D1\u30BF\u30FC\u30F3${_issue.pattern}\u306B\u4E00\u81F4\u3059\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
        return `\u7121\u52B9\u306A${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u7121\u52B9\u306A\u6570\u5024: ${issue2.divisor}\u306E\u500D\u6570\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`;
      case "unrecognized_keys":
        return `\u8A8D\u8B58\u3055\u308C\u3066\u3044\u306A\u3044\u30AD\u30FC${issue2.keys.length > 1 ? "\u7FA4" : ""}: ${joinValues(issue2.keys, "\u3001")}`;
      case "invalid_key":
        return `${issue2.origin}\u5185\u306E\u7121\u52B9\u306A\u30AD\u30FC`;
      case "invalid_union":
        return "\u7121\u52B9\u306A\u5165\u529B";
      case "invalid_element":
        return `${issue2.origin}\u5185\u306E\u7121\u52B9\u306A\u5024`;
      default:
        return `\u7121\u52B9\u306A\u5165\u529B`;
    }
  };
};
function ja_default() {
  return {
    localeError: error24()
  };
}

// node_modules/zod/v4/locales/ka.js
var error25 = () => {
  const Sizable = {
    string: { unit: "\u10E1\u10D8\u10DB\u10D1\u10DD\u10DA\u10DD", verb: "\u10E3\u10DC\u10D3\u10D0 \u10E8\u10D4\u10D8\u10EA\u10D0\u10D5\u10D3\u10D4\u10E1" },
    file: { unit: "\u10D1\u10D0\u10D8\u10E2\u10D8", verb: "\u10E3\u10DC\u10D3\u10D0 \u10E8\u10D4\u10D8\u10EA\u10D0\u10D5\u10D3\u10D4\u10E1" },
    array: { unit: "\u10D4\u10DA\u10D4\u10DB\u10D4\u10DC\u10E2\u10D8", verb: "\u10E3\u10DC\u10D3\u10D0 \u10E8\u10D4\u10D8\u10EA\u10D0\u10D5\u10D3\u10D4\u10E1" },
    set: { unit: "\u10D4\u10DA\u10D4\u10DB\u10D4\u10DC\u10E2\u10D8", verb: "\u10E3\u10DC\u10D3\u10D0 \u10E8\u10D4\u10D8\u10EA\u10D0\u10D5\u10D3\u10D4\u10E1" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u10E8\u10D4\u10E7\u10D5\u10D0\u10DC\u10D0",
    email: "\u10D4\u10DA-\u10E4\u10DD\u10E1\u10E2\u10D8\u10E1 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8",
    url: "URL",
    emoji: "\u10D4\u10DB\u10DD\u10EF\u10D8",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\u10D7\u10D0\u10E0\u10D8\u10E6\u10D8-\u10D3\u10E0\u10DD",
    date: "\u10D7\u10D0\u10E0\u10D8\u10E6\u10D8",
    time: "\u10D3\u10E0\u10DD",
    duration: "\u10EE\u10D0\u10DC\u10D2\u10E0\u10EB\u10DA\u10D8\u10D5\u10DD\u10D1\u10D0",
    ipv4: "IPv4 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8",
    ipv6: "IPv6 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8",
    cidrv4: "IPv4 \u10D3\u10D8\u10D0\u10DE\u10D0\u10D6\u10DD\u10DC\u10D8",
    cidrv6: "IPv6 \u10D3\u10D8\u10D0\u10DE\u10D0\u10D6\u10DD\u10DC\u10D8",
    base64: "base64-\u10D9\u10DD\u10D3\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D8 \u10D5\u10D4\u10DA\u10D8",
    base64url: "base64url-\u10D9\u10DD\u10D3\u10D8\u10E0\u10D4\u10D1\u10E3\u10DA\u10D8 \u10D5\u10D4\u10DA\u10D8",
    json_string: "JSON \u10D5\u10D4\u10DA\u10D8",
    e164: "E.164 \u10DC\u10DD\u10DB\u10D4\u10E0\u10D8",
    jwt: "JWT",
    template_literal: "\u10E8\u10D4\u10E7\u10D5\u10D0\u10DC\u10D0"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u10E0\u10D8\u10EA\u10EE\u10D5\u10D8",
    string: "\u10D5\u10D4\u10DA\u10D8",
    boolean: "\u10D1\u10E3\u10DA\u10D4\u10D0\u10DC\u10D8",
    function: "\u10E4\u10E3\u10DC\u10E5\u10EA\u10D8\u10D0",
    array: "\u10DB\u10D0\u10E1\u10D8\u10D5\u10D8"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10E8\u10D4\u10E7\u10D5\u10D0\u10DC\u10D0: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 instanceof ${issue2.expected}, \u10DB\u10D8\u10E6\u10D4\u10D1\u10E3\u10DA\u10D8 ${received}`;
        }
        return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10E8\u10D4\u10E7\u10D5\u10D0\u10DC\u10D0: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 ${expected}, \u10DB\u10D8\u10E6\u10D4\u10D1\u10E3\u10DA\u10D8 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10E8\u10D4\u10E7\u10D5\u10D0\u10DC\u10D0: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 ${stringifyPrimitive(issue2.values[0])}`;
        return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10D5\u10D0\u10E0\u10D8\u10D0\u10DC\u10E2\u10D8: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8\u10D0 \u10D4\u10E0\u10D7-\u10D4\u10E0\u10D7\u10D8 ${joinValues(issue2.values, "|")}-\u10D3\u10D0\u10DC`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10D0\u10D3 \u10D3\u10D8\u10D3\u10D8: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 ${issue2.origin ?? "\u10DB\u10DC\u10D8\u10E8\u10D5\u10DC\u10D4\u10DA\u10DD\u10D1\u10D0"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        return `\u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10D0\u10D3 \u10D3\u10D8\u10D3\u10D8: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 ${issue2.origin ?? "\u10DB\u10DC\u10D8\u10E8\u10D5\u10DC\u10D4\u10DA\u10DD\u10D1\u10D0"} \u10D8\u10E7\u10DD\u10E1 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10D0\u10D3 \u10DE\u10D0\u10E2\u10D0\u10E0\u10D0: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u10D6\u10D4\u10D3\u10DB\u10D4\u10E2\u10D0\u10D3 \u10DE\u10D0\u10E2\u10D0\u10E0\u10D0: \u10DB\u10DD\u10E1\u10D0\u10DA\u10DD\u10D3\u10DC\u10D4\u10DA\u10D8 ${issue2.origin} \u10D8\u10E7\u10DD\u10E1 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10D5\u10D4\u10DA\u10D8: \u10E3\u10DC\u10D3\u10D0 \u10D8\u10EC\u10E7\u10D4\u10D1\u10DD\u10D3\u10D4\u10E1 "${_issue.prefix}"-\u10D8\u10D7`;
        }
        if (_issue.format === "ends_with")
          return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10D5\u10D4\u10DA\u10D8: \u10E3\u10DC\u10D3\u10D0 \u10DB\u10D7\u10D0\u10D5\u10E0\u10D3\u10D4\u10D1\u10DD\u10D3\u10D4\u10E1 "${_issue.suffix}"-\u10D8\u10D7`;
        if (_issue.format === "includes")
          return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10D5\u10D4\u10DA\u10D8: \u10E3\u10DC\u10D3\u10D0 \u10E8\u10D4\u10D8\u10EA\u10D0\u10D5\u10D3\u10D4\u10E1 "${_issue.includes}"-\u10E1`;
        if (_issue.format === "regex")
          return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10D5\u10D4\u10DA\u10D8: \u10E3\u10DC\u10D3\u10D0 \u10E8\u10D4\u10D4\u10E1\u10D0\u10D1\u10D0\u10DB\u10D4\u10D1\u10DD\u10D3\u10D4\u10E1 \u10E8\u10D0\u10D1\u10DA\u10DD\u10DC\u10E1 ${_issue.pattern}`;
        return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10E0\u10D8\u10EA\u10EE\u10D5\u10D8: \u10E3\u10DC\u10D3\u10D0 \u10D8\u10E7\u10DD\u10E1 ${issue2.divisor}-\u10D8\u10E1 \u10EF\u10D4\u10E0\u10D0\u10D3\u10D8`;
      case "unrecognized_keys":
        return `\u10E3\u10EA\u10DC\u10DD\u10D1\u10D8 \u10D2\u10D0\u10E1\u10D0\u10E6\u10D4\u10D1${issue2.keys.length > 1 ? "\u10D4\u10D1\u10D8" : "\u10D8"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10D2\u10D0\u10E1\u10D0\u10E6\u10D4\u10D1\u10D8 ${issue2.origin}-\u10E8\u10D8`;
      case "invalid_union":
        return "\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10E8\u10D4\u10E7\u10D5\u10D0\u10DC\u10D0";
      case "invalid_element":
        return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10DB\u10DC\u10D8\u10E8\u10D5\u10DC\u10D4\u10DA\u10DD\u10D1\u10D0 ${issue2.origin}-\u10E8\u10D8`;
      default:
        return `\u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8 \u10E8\u10D4\u10E7\u10D5\u10D0\u10DC\u10D0`;
    }
  };
};
function ka_default() {
  return {
    localeError: error25()
  };
}

// node_modules/zod/v4/locales/km.js
var error26 = () => {
  const Sizable = {
    string: { unit: "\u178F\u17BD\u17A2\u1780\u17D2\u179F\u179A", verb: "\u1782\u17BD\u179A\u1798\u17B6\u1793" },
    file: { unit: "\u1794\u17C3", verb: "\u1782\u17BD\u179A\u1798\u17B6\u1793" },
    array: { unit: "\u1792\u17B6\u178F\u17BB", verb: "\u1782\u17BD\u179A\u1798\u17B6\u1793" },
    set: { unit: "\u1792\u17B6\u178F\u17BB", verb: "\u1782\u17BD\u179A\u1798\u17B6\u1793" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1794\u1789\u17D2\u1785\u17BC\u179B",
    email: "\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793\u17A2\u17CA\u17B8\u1798\u17C2\u179B",
    url: "URL",
    emoji: "\u179F\u1789\u17D2\u1789\u17B6\u17A2\u17B6\u179A\u1798\u17D2\u1798\u178E\u17CD",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\u1780\u17B6\u179B\u1794\u179A\u17B7\u1785\u17D2\u1786\u17C1\u1791 \u1793\u17B7\u1784\u1798\u17C9\u17C4\u1784 ISO",
    date: "\u1780\u17B6\u179B\u1794\u179A\u17B7\u1785\u17D2\u1786\u17C1\u1791 ISO",
    time: "\u1798\u17C9\u17C4\u1784 ISO",
    duration: "\u179A\u1799\u17C8\u1796\u17C1\u179B ISO",
    ipv4: "\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793 IPv4",
    ipv6: "\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793 IPv6",
    cidrv4: "\u178A\u17C2\u1793\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793 IPv4",
    cidrv6: "\u178A\u17C2\u1793\u17A2\u17B6\u179F\u1799\u178A\u17D2\u178B\u17B6\u1793 IPv6",
    base64: "\u1781\u17D2\u179F\u17C2\u17A2\u1780\u17D2\u179F\u179A\u17A2\u17CA\u17B7\u1780\u17BC\u178A base64",
    base64url: "\u1781\u17D2\u179F\u17C2\u17A2\u1780\u17D2\u179F\u179A\u17A2\u17CA\u17B7\u1780\u17BC\u178A base64url",
    json_string: "\u1781\u17D2\u179F\u17C2\u17A2\u1780\u17D2\u179F\u179A JSON",
    e164: "\u179B\u17C1\u1781 E.164",
    jwt: "JWT",
    template_literal: "\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1794\u1789\u17D2\u1785\u17BC\u179B"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u179B\u17C1\u1781",
    array: "\u17A2\u17B6\u179A\u17C1 (Array)",
    null: "\u1782\u17D2\u1798\u17B6\u1793\u178F\u1798\u17D2\u179B\u17C3 (null)"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1794\u1789\u17D2\u1785\u17BC\u179B\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1780\u17B6\u179A instanceof ${issue2.expected} \u1794\u17C9\u17BB\u1793\u17D2\u178F\u17C2\u1791\u1791\u17BD\u179B\u1794\u17B6\u1793 ${received}`;
        }
        return `\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1794\u1789\u17D2\u1785\u17BC\u179B\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1780\u17B6\u179A ${expected} \u1794\u17C9\u17BB\u1793\u17D2\u178F\u17C2\u1791\u1791\u17BD\u179B\u1794\u17B6\u1793 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1794\u1789\u17D2\u1785\u17BC\u179B\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1780\u17B6\u179A ${stringifyPrimitive(issue2.values[0])}`;
        return `\u1787\u1798\u17D2\u179A\u17BE\u179F\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1787\u17B6\u1798\u17BD\u1799\u1780\u17D2\u1793\u17BB\u1784\u1785\u17C6\u178E\u17C4\u1798 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u1792\u17C6\u1796\u17C1\u1780\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1780\u17B6\u179A ${issue2.origin ?? "\u178F\u1798\u17D2\u179B\u17C3"} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "\u1792\u17B6\u178F\u17BB"}`;
        return `\u1792\u17C6\u1796\u17C1\u1780\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1780\u17B6\u179A ${issue2.origin ?? "\u178F\u1798\u17D2\u179B\u17C3"} ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u178F\u17BC\u1785\u1796\u17C1\u1780\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1780\u17B6\u179A ${issue2.origin} ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u178F\u17BC\u1785\u1796\u17C1\u1780\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1780\u17B6\u179A ${issue2.origin} ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u1781\u17D2\u179F\u17C2\u17A2\u1780\u17D2\u179F\u179A\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1785\u17B6\u1794\u17CB\u1795\u17D2\u178F\u17BE\u1798\u178A\u17C4\u1799 "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `\u1781\u17D2\u179F\u17C2\u17A2\u1780\u17D2\u179F\u179A\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1794\u1789\u17D2\u1785\u1794\u17CB\u178A\u17C4\u1799 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u1781\u17D2\u179F\u17C2\u17A2\u1780\u17D2\u179F\u179A\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u1798\u17B6\u1793 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u1781\u17D2\u179F\u17C2\u17A2\u1780\u17D2\u179F\u179A\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u178F\u17C2\u1795\u17D2\u1782\u17BC\u1795\u17D2\u1782\u1784\u1793\u17B9\u1784\u1791\u1798\u17D2\u179A\u1784\u17CB\u178A\u17C2\u179B\u1794\u17B6\u1793\u1780\u17C6\u178E\u178F\u17CB ${_issue.pattern}`;
        return `\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u179B\u17C1\u1781\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u17D6 \u178F\u17D2\u179A\u17BC\u179C\u178F\u17C2\u1787\u17B6\u1796\u17A0\u17BB\u1782\u17BB\u178E\u1793\u17C3 ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u179A\u1780\u1783\u17BE\u1789\u179F\u17C4\u1798\u17B7\u1793\u179F\u17D2\u1782\u17B6\u179B\u17CB\u17D6 ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u179F\u17C4\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u1793\u17C5\u1780\u17D2\u1793\u17BB\u1784 ${issue2.origin}`;
      case "invalid_union":
        return `\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C`;
      case "invalid_element":
        return `\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C\u1793\u17C5\u1780\u17D2\u1793\u17BB\u1784 ${issue2.origin}`;
      default:
        return `\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799\u1798\u17B7\u1793\u178F\u17D2\u179A\u17B9\u1798\u178F\u17D2\u179A\u17BC\u179C`;
    }
  };
};
function km_default() {
  return {
    localeError: error26()
  };
}

// node_modules/zod/v4/locales/kh.js
function kh_default() {
  return km_default();
}

// node_modules/zod/v4/locales/ko.js
var error27 = () => {
  const Sizable = {
    string: { unit: "\uBB38\uC790", verb: "to have" },
    file: { unit: "\uBC14\uC774\uD2B8", verb: "to have" },
    array: { unit: "\uAC1C", verb: "to have" },
    set: { unit: "\uAC1C", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\uC785\uB825",
    email: "\uC774\uBA54\uC77C \uC8FC\uC18C",
    url: "URL",
    emoji: "\uC774\uBAA8\uC9C0",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \uB0A0\uC9DC\uC2DC\uAC04",
    date: "ISO \uB0A0\uC9DC",
    time: "ISO \uC2DC\uAC04",
    duration: "ISO \uAE30\uAC04",
    ipv4: "IPv4 \uC8FC\uC18C",
    ipv6: "IPv6 \uC8FC\uC18C",
    cidrv4: "IPv4 \uBC94\uC704",
    cidrv6: "IPv6 \uBC94\uC704",
    base64: "base64 \uC778\uCF54\uB529 \uBB38\uC790\uC5F4",
    base64url: "base64url \uC778\uCF54\uB529 \uBB38\uC790\uC5F4",
    json_string: "JSON \uBB38\uC790\uC5F4",
    e164: "E.164 \uBC88\uD638",
    jwt: "JWT",
    template_literal: "\uC785\uB825"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\uC798\uBABB\uB41C \uC785\uB825: \uC608\uC0C1 \uD0C0\uC785\uC740 instanceof ${issue2.expected}, \uBC1B\uC740 \uD0C0\uC785\uC740 ${received}\uC785\uB2C8\uB2E4`;
        }
        return `\uC798\uBABB\uB41C \uC785\uB825: \uC608\uC0C1 \uD0C0\uC785\uC740 ${expected}, \uBC1B\uC740 \uD0C0\uC785\uC740 ${received}\uC785\uB2C8\uB2E4`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\uC798\uBABB\uB41C \uC785\uB825: \uAC12\uC740 ${stringifyPrimitive(issue2.values[0])} \uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4`;
        return `\uC798\uBABB\uB41C \uC635\uC158: ${joinValues(issue2.values, "\uB610\uB294 ")} \uC911 \uD558\uB098\uC5EC\uC57C \uD569\uB2C8\uB2E4`;
      case "too_big": {
        const adj = issue2.inclusive ? "\uC774\uD558" : "\uBBF8\uB9CC";
        const suffix = adj === "\uBBF8\uB9CC" ? "\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4" : "\uC5EC\uC57C \uD569\uB2C8\uB2E4";
        const sizing = getSizing(issue2.origin);
        const unit = sizing?.unit ?? "\uC694\uC18C";
        if (sizing)
          return `${issue2.origin ?? "\uAC12"}\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4: ${issue2.maximum.toString()}${unit} ${adj}${suffix}`;
        return `${issue2.origin ?? "\uAC12"}\uC774 \uB108\uBB34 \uD07D\uB2C8\uB2E4: ${issue2.maximum.toString()} ${adj}${suffix}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "\uC774\uC0C1" : "\uCD08\uACFC";
        const suffix = adj === "\uC774\uC0C1" ? "\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4" : "\uC5EC\uC57C \uD569\uB2C8\uB2E4";
        const sizing = getSizing(issue2.origin);
        const unit = sizing?.unit ?? "\uC694\uC18C";
        if (sizing) {
          return `${issue2.origin ?? "\uAC12"}\uC774 \uB108\uBB34 \uC791\uC2B5\uB2C8\uB2E4: ${issue2.minimum.toString()}${unit} ${adj}${suffix}`;
        }
        return `${issue2.origin ?? "\uAC12"}\uC774 \uB108\uBB34 \uC791\uC2B5\uB2C8\uB2E4: ${issue2.minimum.toString()} ${adj}${suffix}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\uC798\uBABB\uB41C \uBB38\uC790\uC5F4: "${_issue.prefix}"(\uC73C)\uB85C \uC2DC\uC791\uD574\uC57C \uD569\uB2C8\uB2E4`;
        }
        if (_issue.format === "ends_with")
          return `\uC798\uBABB\uB41C \uBB38\uC790\uC5F4: "${_issue.suffix}"(\uC73C)\uB85C \uB05D\uB098\uC57C \uD569\uB2C8\uB2E4`;
        if (_issue.format === "includes")
          return `\uC798\uBABB\uB41C \uBB38\uC790\uC5F4: "${_issue.includes}"\uC744(\uB97C) \uD3EC\uD568\uD574\uC57C \uD569\uB2C8\uB2E4`;
        if (_issue.format === "regex")
          return `\uC798\uBABB\uB41C \uBB38\uC790\uC5F4: \uC815\uADDC\uC2DD ${_issue.pattern} \uD328\uD134\uACFC \uC77C\uCE58\uD574\uC57C \uD569\uB2C8\uB2E4`;
        return `\uC798\uBABB\uB41C ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\uC798\uBABB\uB41C \uC22B\uC790: ${issue2.divisor}\uC758 \uBC30\uC218\uC5EC\uC57C \uD569\uB2C8\uB2E4`;
      case "unrecognized_keys":
        return `\uC778\uC2DD\uD560 \uC218 \uC5C6\uB294 \uD0A4: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\uC798\uBABB\uB41C \uD0A4: ${issue2.origin}`;
      case "invalid_union":
        return `\uC798\uBABB\uB41C \uC785\uB825`;
      case "invalid_element":
        return `\uC798\uBABB\uB41C \uAC12: ${issue2.origin}`;
      default:
        return `\uC798\uBABB\uB41C \uC785\uB825`;
    }
  };
};
function ko_default() {
  return {
    localeError: error27()
  };
}

// node_modules/zod/v4/locales/lt.js
var capitalizeFirstCharacter = (text) => {
  return text.charAt(0).toUpperCase() + text.slice(1);
};
function getUnitTypeFromNumber(number4) {
  const abs = Math.abs(number4);
  const last = abs % 10;
  const last2 = abs % 100;
  if (last2 >= 11 && last2 <= 19 || last === 0)
    return "many";
  if (last === 1)
    return "one";
  return "few";
}
var error28 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "simbolis",
        few: "simboliai",
        many: "simboli\u0173"
      },
      verb: {
        smaller: {
          inclusive: "turi b\u016Bti ne ilgesn\u0117 kaip",
          notInclusive: "turi b\u016Bti trumpesn\u0117 kaip"
        },
        bigger: {
          inclusive: "turi b\u016Bti ne trumpesn\u0117 kaip",
          notInclusive: "turi b\u016Bti ilgesn\u0117 kaip"
        }
      }
    },
    file: {
      unit: {
        one: "baitas",
        few: "baitai",
        many: "bait\u0173"
      },
      verb: {
        smaller: {
          inclusive: "turi b\u016Bti ne didesnis kaip",
          notInclusive: "turi b\u016Bti ma\u017Eesnis kaip"
        },
        bigger: {
          inclusive: "turi b\u016Bti ne ma\u017Eesnis kaip",
          notInclusive: "turi b\u016Bti didesnis kaip"
        }
      }
    },
    array: {
      unit: {
        one: "element\u0105",
        few: "elementus",
        many: "element\u0173"
      },
      verb: {
        smaller: {
          inclusive: "turi tur\u0117ti ne daugiau kaip",
          notInclusive: "turi tur\u0117ti ma\u017Eiau kaip"
        },
        bigger: {
          inclusive: "turi tur\u0117ti ne ma\u017Eiau kaip",
          notInclusive: "turi tur\u0117ti daugiau kaip"
        }
      }
    },
    set: {
      unit: {
        one: "element\u0105",
        few: "elementus",
        many: "element\u0173"
      },
      verb: {
        smaller: {
          inclusive: "turi tur\u0117ti ne daugiau kaip",
          notInclusive: "turi tur\u0117ti ma\u017Eiau kaip"
        },
        bigger: {
          inclusive: "turi tur\u0117ti ne ma\u017Eiau kaip",
          notInclusive: "turi tur\u0117ti daugiau kaip"
        }
      }
    }
  };
  function getSizing(origin, unitType, inclusive, targetShouldBe) {
    const result = Sizable[origin] ?? null;
    if (result === null)
      return result;
    return {
      unit: result.unit[unitType],
      verb: result.verb[targetShouldBe][inclusive ? "inclusive" : "notInclusive"]
    };
  }
  const FormatDictionary = {
    regex: "\u012Fvestis",
    email: "el. pa\u0161to adresas",
    url: "URL",
    emoji: "jaustukas",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO data ir laikas",
    date: "ISO data",
    time: "ISO laikas",
    duration: "ISO trukm\u0117",
    ipv4: "IPv4 adresas",
    ipv6: "IPv6 adresas",
    cidrv4: "IPv4 tinklo prefiksas (CIDR)",
    cidrv6: "IPv6 tinklo prefiksas (CIDR)",
    base64: "base64 u\u017Ekoduota eilut\u0117",
    base64url: "base64url u\u017Ekoduota eilut\u0117",
    json_string: "JSON eilut\u0117",
    e164: "E.164 numeris",
    jwt: "JWT",
    template_literal: "\u012Fvestis"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "skai\u010Dius",
    bigint: "sveikasis skai\u010Dius",
    string: "eilut\u0117",
    boolean: "login\u0117 reik\u0161m\u0117",
    undefined: "neapibr\u0117\u017Eta reik\u0161m\u0117",
    function: "funkcija",
    symbol: "simbolis",
    array: "masyvas",
    object: "objektas",
    null: "nulin\u0117 reik\u0161m\u0117"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Gautas tipas ${received}, o tik\u0117tasi - instanceof ${issue2.expected}`;
        }
        return `Gautas tipas ${received}, o tik\u0117tasi - ${expected}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Privalo b\u016Bti ${stringifyPrimitive(issue2.values[0])}`;
        return `Privalo b\u016Bti vienas i\u0161 ${joinValues(issue2.values, "|")} pasirinkim\u0173`;
      case "too_big": {
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        const sizing = getSizing(issue2.origin, getUnitTypeFromNumber(Number(issue2.maximum)), issue2.inclusive ?? false, "smaller");
        if (sizing?.verb)
          return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reik\u0161m\u0117")} ${sizing.verb} ${issue2.maximum.toString()} ${sizing.unit ?? "element\u0173"}`;
        const adj = issue2.inclusive ? "ne didesnis kaip" : "ma\u017Eesnis kaip";
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reik\u0161m\u0117")} turi b\u016Bti ${adj} ${issue2.maximum.toString()} ${sizing?.unit}`;
      }
      case "too_small": {
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        const sizing = getSizing(issue2.origin, getUnitTypeFromNumber(Number(issue2.minimum)), issue2.inclusive ?? false, "bigger");
        if (sizing?.verb)
          return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reik\u0161m\u0117")} ${sizing.verb} ${issue2.minimum.toString()} ${sizing.unit ?? "element\u0173"}`;
        const adj = issue2.inclusive ? "ne ma\u017Eesnis kaip" : "didesnis kaip";
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reik\u0161m\u0117")} turi b\u016Bti ${adj} ${issue2.minimum.toString()} ${sizing?.unit}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Eilut\u0117 privalo prasid\u0117ti "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Eilut\u0117 privalo pasibaigti "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Eilut\u0117 privalo \u012Ftraukti "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Eilut\u0117 privalo atitikti ${_issue.pattern}`;
        return `Neteisingas ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Skai\u010Dius privalo b\u016Bti ${issue2.divisor} kartotinis.`;
      case "unrecognized_keys":
        return `Neatpa\u017Eint${issue2.keys.length > 1 ? "i" : "as"} rakt${issue2.keys.length > 1 ? "ai" : "as"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return "Rastas klaidingas raktas";
      case "invalid_union":
        return "Klaidinga \u012Fvestis";
      case "invalid_element": {
        const origin = TypeDictionary[issue2.origin] ?? issue2.origin;
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reik\u0161m\u0117")} turi klaiding\u0105 \u012Fvest\u012F`;
      }
      default:
        return "Klaidinga \u012Fvestis";
    }
  };
};
function lt_default() {
  return {
    localeError: error28()
  };
}

// node_modules/zod/v4/locales/mk.js
var error29 = () => {
  const Sizable = {
    string: { unit: "\u0437\u043D\u0430\u0446\u0438", verb: "\u0434\u0430 \u0438\u043C\u0430\u0430\u0442" },
    file: { unit: "\u0431\u0430\u0458\u0442\u0438", verb: "\u0434\u0430 \u0438\u043C\u0430\u0430\u0442" },
    array: { unit: "\u0441\u0442\u0430\u0432\u043A\u0438", verb: "\u0434\u0430 \u0438\u043C\u0430\u0430\u0442" },
    set: { unit: "\u0441\u0442\u0430\u0432\u043A\u0438", verb: "\u0434\u0430 \u0438\u043C\u0430\u0430\u0442" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0432\u043D\u0435\u0441",
    email: "\u0430\u0434\u0440\u0435\u0441\u0430 \u043D\u0430 \u0435-\u043F\u043E\u0448\u0442\u0430",
    url: "URL",
    emoji: "\u0435\u043C\u043E\u045F\u0438",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u0434\u0430\u0442\u0443\u043C \u0438 \u0432\u0440\u0435\u043C\u0435",
    date: "ISO \u0434\u0430\u0442\u0443\u043C",
    time: "ISO \u0432\u0440\u0435\u043C\u0435",
    duration: "ISO \u0432\u0440\u0435\u043C\u0435\u0442\u0440\u0430\u0435\u045A\u0435",
    ipv4: "IPv4 \u0430\u0434\u0440\u0435\u0441\u0430",
    ipv6: "IPv6 \u0430\u0434\u0440\u0435\u0441\u0430",
    cidrv4: "IPv4 \u043E\u043F\u0441\u0435\u0433",
    cidrv6: "IPv6 \u043E\u043F\u0441\u0435\u0433",
    base64: "base64-\u0435\u043D\u043A\u043E\u0434\u0438\u0440\u0430\u043D\u0430 \u043D\u0438\u0437\u0430",
    base64url: "base64url-\u0435\u043D\u043A\u043E\u0434\u0438\u0440\u0430\u043D\u0430 \u043D\u0438\u0437\u0430",
    json_string: "JSON \u043D\u0438\u0437\u0430",
    e164: "E.164 \u0431\u0440\u043E\u0458",
    jwt: "JWT",
    template_literal: "\u0432\u043D\u0435\u0441"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0431\u0440\u043E\u0458",
    array: "\u043D\u0438\u0437\u0430"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u0413\u0440\u0435\u0448\u0435\u043D \u0432\u043D\u0435\u0441: \u0441\u0435 \u043E\u0447\u0435\u043A\u0443\u0432\u0430 instanceof ${issue2.expected}, \u043F\u0440\u0438\u043C\u0435\u043D\u043E ${received}`;
        }
        return `\u0413\u0440\u0435\u0448\u0435\u043D \u0432\u043D\u0435\u0441: \u0441\u0435 \u043E\u0447\u0435\u043A\u0443\u0432\u0430 ${expected}, \u043F\u0440\u0438\u043C\u0435\u043D\u043E ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `\u0413\u0440\u0435\u0448\u0430\u043D\u0430 \u043E\u043F\u0446\u0438\u0458\u0430: \u0441\u0435 \u043E\u0447\u0435\u043A\u0443\u0432\u0430 \u0435\u0434\u043D\u0430 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u041F\u0440\u0435\u043C\u043D\u043E\u0433\u0443 \u0433\u043E\u043B\u0435\u043C: \u0441\u0435 \u043E\u0447\u0435\u043A\u0443\u0432\u0430 ${issue2.origin ?? "\u0432\u0440\u0435\u0434\u043D\u043E\u0441\u0442\u0430"} \u0434\u0430 \u0438\u043C\u0430 ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u0435\u043B\u0435\u043C\u0435\u043D\u0442\u0438"}`;
        return `\u041F\u0440\u0435\u043C\u043D\u043E\u0433\u0443 \u0433\u043E\u043B\u0435\u043C: \u0441\u0435 \u043E\u0447\u0435\u043A\u0443\u0432\u0430 ${issue2.origin ?? "\u0432\u0440\u0435\u0434\u043D\u043E\u0441\u0442\u0430"} \u0434\u0430 \u0431\u0438\u0434\u0435 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u041F\u0440\u0435\u043C\u043D\u043E\u0433\u0443 \u043C\u0430\u043B: \u0441\u0435 \u043E\u0447\u0435\u043A\u0443\u0432\u0430 ${issue2.origin} \u0434\u0430 \u0438\u043C\u0430 ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u041F\u0440\u0435\u043C\u043D\u043E\u0433\u0443 \u043C\u0430\u043B: \u0441\u0435 \u043E\u0447\u0435\u043A\u0443\u0432\u0430 ${issue2.origin} \u0434\u0430 \u0431\u0438\u0434\u0435 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u041D\u0435\u0432\u0430\u0436\u0435\u0447\u043A\u0430 \u043D\u0438\u0437\u0430: \u043C\u043E\u0440\u0430 \u0434\u0430 \u0437\u0430\u043F\u043E\u0447\u043D\u0443\u0432\u0430 \u0441\u043E "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `\u041D\u0435\u0432\u0430\u0436\u0435\u0447\u043A\u0430 \u043D\u0438\u0437\u0430: \u043C\u043E\u0440\u0430 \u0434\u0430 \u0437\u0430\u0432\u0440\u0448\u0443\u0432\u0430 \u0441\u043E "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u041D\u0435\u0432\u0430\u0436\u0435\u0447\u043A\u0430 \u043D\u0438\u0437\u0430: \u043C\u043E\u0440\u0430 \u0434\u0430 \u0432\u043A\u043B\u0443\u0447\u0443\u0432\u0430 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u041D\u0435\u0432\u0430\u0436\u0435\u0447\u043A\u0430 \u043D\u0438\u0437\u0430: \u043C\u043E\u0440\u0430 \u0434\u0430 \u043E\u0434\u0433\u043E\u0430\u0440\u0430 \u043D\u0430 \u043F\u0430\u0442\u0435\u0440\u043D\u043E\u0442 ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u0413\u0440\u0435\u0448\u0435\u043D \u0431\u0440\u043E\u0458: \u043C\u043E\u0440\u0430 \u0434\u0430 \u0431\u0438\u0434\u0435 \u0434\u0435\u043B\u0438\u0432 \u0441\u043E ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "\u041D\u0435\u043F\u0440\u0435\u043F\u043E\u0437\u043D\u0430\u0435\u043D\u0438 \u043A\u043B\u0443\u0447\u0435\u0432\u0438" : "\u041D\u0435\u043F\u0440\u0435\u043F\u043E\u0437\u043D\u0430\u0435\u043D \u043A\u043B\u0443\u0447"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u0413\u0440\u0435\u0448\u0435\u043D \u043A\u043B\u0443\u0447 \u0432\u043E ${issue2.origin}`;
      case "invalid_union":
        return "\u0413\u0440\u0435\u0448\u0435\u043D \u0432\u043D\u0435\u0441";
      case "invalid_element":
        return `\u0413\u0440\u0435\u0448\u043D\u0430 \u0432\u0440\u0435\u0434\u043D\u043E\u0441\u0442 \u0432\u043E ${issue2.origin}`;
      default:
        return `\u0413\u0440\u0435\u0448\u0435\u043D \u0432\u043D\u0435\u0441`;
    }
  };
};
function mk_default() {
  return {
    localeError: error29()
  };
}

// node_modules/zod/v4/locales/ms.js
var error30 = () => {
  const Sizable = {
    string: { unit: "aksara", verb: "mempunyai" },
    file: { unit: "bait", verb: "mempunyai" },
    array: { unit: "elemen", verb: "mempunyai" },
    set: { unit: "elemen", verb: "mempunyai" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "alamat e-mel",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "tarikh masa ISO",
    date: "tarikh ISO",
    time: "masa ISO",
    duration: "tempoh ISO",
    ipv4: "alamat IPv4",
    ipv6: "alamat IPv6",
    cidrv4: "julat IPv4",
    cidrv6: "julat IPv6",
    base64: "string dikodkan base64",
    base64url: "string dikodkan base64url",
    json_string: "string JSON",
    e164: "nombor E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "nombor"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Input tidak sah: dijangka instanceof ${issue2.expected}, diterima ${received}`;
        }
        return `Input tidak sah: dijangka ${expected}, diterima ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input tidak sah: dijangka ${stringifyPrimitive(issue2.values[0])}`;
        return `Pilihan tidak sah: dijangka salah satu daripada ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Terlalu besar: dijangka ${issue2.origin ?? "nilai"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemen"}`;
        return `Terlalu besar: dijangka ${issue2.origin ?? "nilai"} adalah ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Terlalu kecil: dijangka ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Terlalu kecil: dijangka ${issue2.origin} adalah ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `String tidak sah: mesti bermula dengan "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `String tidak sah: mesti berakhir dengan "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `String tidak sah: mesti mengandungi "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `String tidak sah: mesti sepadan dengan corak ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} tidak sah`;
      }
      case "not_multiple_of":
        return `Nombor tidak sah: perlu gandaan ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Kunci tidak dikenali: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Kunci tidak sah dalam ${issue2.origin}`;
      case "invalid_union":
        return "Input tidak sah";
      case "invalid_element":
        return `Nilai tidak sah dalam ${issue2.origin}`;
      default:
        return `Input tidak sah`;
    }
  };
};
function ms_default() {
  return {
    localeError: error30()
  };
}

// node_modules/zod/v4/locales/nl.js
var error31 = () => {
  const Sizable = {
    string: { unit: "tekens", verb: "heeft" },
    file: { unit: "bytes", verb: "heeft" },
    array: { unit: "elementen", verb: "heeft" },
    set: { unit: "elementen", verb: "heeft" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "invoer",
    email: "emailadres",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum en tijd",
    date: "ISO datum",
    time: "ISO tijd",
    duration: "ISO duur",
    ipv4: "IPv4-adres",
    ipv6: "IPv6-adres",
    cidrv4: "IPv4-bereik",
    cidrv6: "IPv6-bereik",
    base64: "base64-gecodeerde tekst",
    base64url: "base64 URL-gecodeerde tekst",
    json_string: "JSON string",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "invoer"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "getal"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ongeldige invoer: verwacht instanceof ${issue2.expected}, ontving ${received}`;
        }
        return `Ongeldige invoer: verwacht ${expected}, ontving ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ongeldige invoer: verwacht ${stringifyPrimitive(issue2.values[0])}`;
        return `Ongeldige optie: verwacht \xE9\xE9n van ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const longName = issue2.origin === "date" ? "laat" : issue2.origin === "string" ? "lang" : "groot";
        if (sizing)
          return `Te ${longName}: verwacht dat ${issue2.origin ?? "waarde"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementen"} ${sizing.verb}`;
        return `Te ${longName}: verwacht dat ${issue2.origin ?? "waarde"} ${adj}${issue2.maximum.toString()} is`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const shortName = issue2.origin === "date" ? "vroeg" : issue2.origin === "string" ? "kort" : "klein";
        if (sizing) {
          return `Te ${shortName}: verwacht dat ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
        }
        return `Te ${shortName}: verwacht dat ${issue2.origin} ${adj}${issue2.minimum.toString()} is`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ongeldige tekst: moet met "${_issue.prefix}" beginnen`;
        }
        if (_issue.format === "ends_with")
          return `Ongeldige tekst: moet op "${_issue.suffix}" eindigen`;
        if (_issue.format === "includes")
          return `Ongeldige tekst: moet "${_issue.includes}" bevatten`;
        if (_issue.format === "regex")
          return `Ongeldige tekst: moet overeenkomen met patroon ${_issue.pattern}`;
        return `Ongeldig: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ongeldig getal: moet een veelvoud van ${issue2.divisor} zijn`;
      case "unrecognized_keys":
        return `Onbekende key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ongeldige key in ${issue2.origin}`;
      case "invalid_union":
        return "Ongeldige invoer";
      case "invalid_element":
        return `Ongeldige waarde in ${issue2.origin}`;
      default:
        return `Ongeldige invoer`;
    }
  };
};
function nl_default() {
  return {
    localeError: error31()
  };
}

// node_modules/zod/v4/locales/no.js
var error32 = () => {
  const Sizable = {
    string: { unit: "tegn", verb: "\xE5 ha" },
    file: { unit: "bytes", verb: "\xE5 ha" },
    array: { unit: "elementer", verb: "\xE5 inneholde" },
    set: { unit: "elementer", verb: "\xE5 inneholde" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "e-postadresse",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dato- og klokkeslett",
    date: "ISO-dato",
    time: "ISO-klokkeslett",
    duration: "ISO-varighet",
    ipv4: "IPv4-omr\xE5de",
    ipv6: "IPv6-omr\xE5de",
    cidrv4: "IPv4-spekter",
    cidrv6: "IPv6-spekter",
    base64: "base64-enkodet streng",
    base64url: "base64url-enkodet streng",
    json_string: "JSON-streng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "tall",
    array: "liste"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ugyldig input: forventet instanceof ${issue2.expected}, fikk ${received}`;
        }
        return `Ugyldig input: forventet ${expected}, fikk ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ugyldig verdi: forventet ${stringifyPrimitive(issue2.values[0])}`;
        return `Ugyldig valg: forventet en av ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `For stor(t): forventet ${issue2.origin ?? "value"} til \xE5 ha ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementer"}`;
        return `For stor(t): forventet ${issue2.origin ?? "value"} til \xE5 ha ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `For lite(n): forventet ${issue2.origin} til \xE5 ha ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `For lite(n): forventet ${issue2.origin} til \xE5 ha ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ugyldig streng: m\xE5 starte med "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ugyldig streng: m\xE5 ende med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ugyldig streng: m\xE5 inneholde "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ugyldig streng: m\xE5 matche m\xF8nsteret ${_issue.pattern}`;
        return `Ugyldig ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ugyldig tall: m\xE5 v\xE6re et multiplum av ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Ukjente n\xF8kler" : "Ukjent n\xF8kkel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ugyldig n\xF8kkel i ${issue2.origin}`;
      case "invalid_union":
        return "Ugyldig input";
      case "invalid_element":
        return `Ugyldig verdi i ${issue2.origin}`;
      default:
        return `Ugyldig input`;
    }
  };
};
function no_default() {
  return {
    localeError: error32()
  };
}

// node_modules/zod/v4/locales/ota.js
var error33 = () => {
  const Sizable = {
    string: { unit: "harf", verb: "olmal\u0131d\u0131r" },
    file: { unit: "bayt", verb: "olmal\u0131d\u0131r" },
    array: { unit: "unsur", verb: "olmal\u0131d\u0131r" },
    set: { unit: "unsur", verb: "olmal\u0131d\u0131r" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "giren",
    email: "epostag\xE2h",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO heng\xE2m\u0131",
    date: "ISO tarihi",
    time: "ISO zaman\u0131",
    duration: "ISO m\xFCddeti",
    ipv4: "IPv4 ni\u015F\xE2n\u0131",
    ipv6: "IPv6 ni\u015F\xE2n\u0131",
    cidrv4: "IPv4 menzili",
    cidrv6: "IPv6 menzili",
    base64: "base64-\u015Fifreli metin",
    base64url: "base64url-\u015Fifreli metin",
    json_string: "JSON metin",
    e164: "E.164 say\u0131s\u0131",
    jwt: "JWT",
    template_literal: "giren"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "numara",
    array: "saf",
    null: "gayb"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `F\xE2sit giren: umulan instanceof ${issue2.expected}, al\u0131nan ${received}`;
        }
        return `F\xE2sit giren: umulan ${expected}, al\u0131nan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `F\xE2sit giren: umulan ${stringifyPrimitive(issue2.values[0])}`;
        return `F\xE2sit tercih: m\xFBteberler ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Fazla b\xFCy\xFCk: ${issue2.origin ?? "value"}, ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"} sahip olmal\u0131yd\u0131.`;
        return `Fazla b\xFCy\xFCk: ${issue2.origin ?? "value"}, ${adj}${issue2.maximum.toString()} olmal\u0131yd\u0131.`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Fazla k\xFC\xE7\xFCk: ${issue2.origin}, ${adj}${issue2.minimum.toString()} ${sizing.unit} sahip olmal\u0131yd\u0131.`;
        }
        return `Fazla k\xFC\xE7\xFCk: ${issue2.origin}, ${adj}${issue2.minimum.toString()} olmal\u0131yd\u0131.`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `F\xE2sit metin: "${_issue.prefix}" ile ba\u015Flamal\u0131.`;
        if (_issue.format === "ends_with")
          return `F\xE2sit metin: "${_issue.suffix}" ile bitmeli.`;
        if (_issue.format === "includes")
          return `F\xE2sit metin: "${_issue.includes}" ihtiv\xE2 etmeli.`;
        if (_issue.format === "regex")
          return `F\xE2sit metin: ${_issue.pattern} nak\u015F\u0131na uymal\u0131.`;
        return `F\xE2sit ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `F\xE2sit say\u0131: ${issue2.divisor} kat\u0131 olmal\u0131yd\u0131.`;
      case "unrecognized_keys":
        return `Tan\u0131nmayan anahtar ${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} i\xE7in tan\u0131nmayan anahtar var.`;
      case "invalid_union":
        return "Giren tan\u0131namad\u0131.";
      case "invalid_element":
        return `${issue2.origin} i\xE7in tan\u0131nmayan k\u0131ymet var.`;
      default:
        return `K\u0131ymet tan\u0131namad\u0131.`;
    }
  };
};
function ota_default() {
  return {
    localeError: error33()
  };
}

// node_modules/zod/v4/locales/ps.js
var error34 = () => {
  const Sizable = {
    string: { unit: "\u062A\u0648\u06A9\u064A", verb: "\u0648\u0644\u0631\u064A" },
    file: { unit: "\u0628\u0627\u06CC\u067C\u0633", verb: "\u0648\u0644\u0631\u064A" },
    array: { unit: "\u062A\u0648\u06A9\u064A", verb: "\u0648\u0644\u0631\u064A" },
    set: { unit: "\u062A\u0648\u06A9\u064A", verb: "\u0648\u0644\u0631\u064A" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0648\u0631\u0648\u062F\u064A",
    email: "\u0628\u0631\u06CC\u069A\u0646\u0627\u0644\u06CC\u06A9",
    url: "\u06CC\u0648 \u0622\u0631 \u0627\u0644",
    emoji: "\u0627\u06CC\u0645\u0648\u062C\u064A",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\u0646\u06CC\u067C\u0647 \u0627\u0648 \u0648\u062E\u062A",
    date: "\u0646\u06D0\u067C\u0647",
    time: "\u0648\u062E\u062A",
    duration: "\u0645\u0648\u062F\u0647",
    ipv4: "\u062F IPv4 \u067E\u062A\u0647",
    ipv6: "\u062F IPv6 \u067E\u062A\u0647",
    cidrv4: "\u062F IPv4 \u0633\u0627\u062D\u0647",
    cidrv6: "\u062F IPv6 \u0633\u0627\u062D\u0647",
    base64: "base64-encoded \u0645\u062A\u0646",
    base64url: "base64url-encoded \u0645\u062A\u0646",
    json_string: "JSON \u0645\u062A\u0646",
    e164: "\u062F E.164 \u0634\u0645\u06D0\u0631\u0647",
    jwt: "JWT",
    template_literal: "\u0648\u0631\u0648\u062F\u064A"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0639\u062F\u062F",
    array: "\u0627\u0631\u06D0"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u0646\u0627\u0633\u0645 \u0648\u0631\u0648\u062F\u064A: \u0628\u0627\u06CC\u062F instanceof ${issue2.expected} \u0648\u0627\u06CC, \u0645\u06AB\u0631 ${received} \u062A\u0631\u0644\u0627\u0633\u0647 \u0634\u0648`;
        }
        return `\u0646\u0627\u0633\u0645 \u0648\u0631\u0648\u062F\u064A: \u0628\u0627\u06CC\u062F ${expected} \u0648\u0627\u06CC, \u0645\u06AB\u0631 ${received} \u062A\u0631\u0644\u0627\u0633\u0647 \u0634\u0648`;
      }
      case "invalid_value":
        if (issue2.values.length === 1) {
          return `\u0646\u0627\u0633\u0645 \u0648\u0631\u0648\u062F\u064A: \u0628\u0627\u06CC\u062F ${stringifyPrimitive(issue2.values[0])} \u0648\u0627\u06CC`;
        }
        return `\u0646\u0627\u0633\u0645 \u0627\u0646\u062A\u062E\u0627\u0628: \u0628\u0627\u06CC\u062F \u06CC\u0648 \u0644\u0647 ${joinValues(issue2.values, "|")} \u0685\u062E\u0647 \u0648\u0627\u06CC`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0689\u06CC\u0631 \u0644\u0648\u06CC: ${issue2.origin ?? "\u0627\u0631\u0632\u069A\u062A"} \u0628\u0627\u06CC\u062F ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u0639\u0646\u0635\u0631\u0648\u0646\u0647"} \u0648\u0644\u0631\u064A`;
        }
        return `\u0689\u06CC\u0631 \u0644\u0648\u06CC: ${issue2.origin ?? "\u0627\u0631\u0632\u069A\u062A"} \u0628\u0627\u06CC\u062F ${adj}${issue2.maximum.toString()} \u0648\u064A`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0689\u06CC\u0631 \u06A9\u0648\u0686\u0646\u06CC: ${issue2.origin} \u0628\u0627\u06CC\u062F ${adj}${issue2.minimum.toString()} ${sizing.unit} \u0648\u0644\u0631\u064A`;
        }
        return `\u0689\u06CC\u0631 \u06A9\u0648\u0686\u0646\u06CC: ${issue2.origin} \u0628\u0627\u06CC\u062F ${adj}${issue2.minimum.toString()} \u0648\u064A`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u0646\u0627\u0633\u0645 \u0645\u062A\u0646: \u0628\u0627\u06CC\u062F \u062F "${_issue.prefix}" \u0633\u0631\u0647 \u067E\u06CC\u0644 \u0634\u064A`;
        }
        if (_issue.format === "ends_with") {
          return `\u0646\u0627\u0633\u0645 \u0645\u062A\u0646: \u0628\u0627\u06CC\u062F \u062F "${_issue.suffix}" \u0633\u0631\u0647 \u067E\u0627\u06CC \u062A\u0647 \u0648\u0631\u0633\u064A\u0696\u064A`;
        }
        if (_issue.format === "includes") {
          return `\u0646\u0627\u0633\u0645 \u0645\u062A\u0646: \u0628\u0627\u06CC\u062F "${_issue.includes}" \u0648\u0644\u0631\u064A`;
        }
        if (_issue.format === "regex") {
          return `\u0646\u0627\u0633\u0645 \u0645\u062A\u0646: \u0628\u0627\u06CC\u062F \u062F ${_issue.pattern} \u0633\u0631\u0647 \u0645\u0637\u0627\u0628\u0642\u062A \u0648\u0644\u0631\u064A`;
        }
        return `${FormatDictionary[_issue.format] ?? issue2.format} \u0646\u0627\u0633\u0645 \u062F\u06CC`;
      }
      case "not_multiple_of":
        return `\u0646\u0627\u0633\u0645 \u0639\u062F\u062F: \u0628\u0627\u06CC\u062F \u062F ${issue2.divisor} \u0645\u0636\u0631\u0628 \u0648\u064A`;
      case "unrecognized_keys":
        return `\u0646\u0627\u0633\u0645 ${issue2.keys.length > 1 ? "\u06A9\u0644\u06CC\u0689\u0648\u0646\u0647" : "\u06A9\u0644\u06CC\u0689"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u0646\u0627\u0633\u0645 \u06A9\u0644\u06CC\u0689 \u067E\u0647 ${issue2.origin} \u06A9\u06D0`;
      case "invalid_union":
        return `\u0646\u0627\u0633\u0645\u0647 \u0648\u0631\u0648\u062F\u064A`;
      case "invalid_element":
        return `\u0646\u0627\u0633\u0645 \u0639\u0646\u0635\u0631 \u067E\u0647 ${issue2.origin} \u06A9\u06D0`;
      default:
        return `\u0646\u0627\u0633\u0645\u0647 \u0648\u0631\u0648\u062F\u064A`;
    }
  };
};
function ps_default() {
  return {
    localeError: error34()
  };
}

// node_modules/zod/v4/locales/pl.js
var error35 = () => {
  const Sizable = {
    string: { unit: "znak\xF3w", verb: "mie\u0107" },
    file: { unit: "bajt\xF3w", verb: "mie\u0107" },
    array: { unit: "element\xF3w", verb: "mie\u0107" },
    set: { unit: "element\xF3w", verb: "mie\u0107" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "wyra\u017Cenie",
    email: "adres email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data i godzina w formacie ISO",
    date: "data w formacie ISO",
    time: "godzina w formacie ISO",
    duration: "czas trwania ISO",
    ipv4: "adres IPv4",
    ipv6: "adres IPv6",
    cidrv4: "zakres IPv4",
    cidrv6: "zakres IPv6",
    base64: "ci\u0105g znak\xF3w zakodowany w formacie base64",
    base64url: "ci\u0105g znak\xF3w zakodowany w formacie base64url",
    json_string: "ci\u0105g znak\xF3w w formacie JSON",
    e164: "liczba E.164",
    jwt: "JWT",
    template_literal: "wej\u015Bcie"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "liczba",
    array: "tablica"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Nieprawid\u0142owe dane wej\u015Bciowe: oczekiwano instanceof ${issue2.expected}, otrzymano ${received}`;
        }
        return `Nieprawid\u0142owe dane wej\u015Bciowe: oczekiwano ${expected}, otrzymano ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Nieprawid\u0142owe dane wej\u015Bciowe: oczekiwano ${stringifyPrimitive(issue2.values[0])}`;
        return `Nieprawid\u0142owa opcja: oczekiwano jednej z warto\u015Bci ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Za du\u017Ca warto\u015B\u0107: oczekiwano, \u017Ce ${issue2.origin ?? "warto\u015B\u0107"} b\u0119dzie mie\u0107 ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "element\xF3w"}`;
        }
        return `Zbyt du\u017C(y/a/e): oczekiwano, \u017Ce ${issue2.origin ?? "warto\u015B\u0107"} b\u0119dzie wynosi\u0107 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Za ma\u0142a warto\u015B\u0107: oczekiwano, \u017Ce ${issue2.origin ?? "warto\u015B\u0107"} b\u0119dzie mie\u0107 ${adj}${issue2.minimum.toString()} ${sizing.unit ?? "element\xF3w"}`;
        }
        return `Zbyt ma\u0142(y/a/e): oczekiwano, \u017Ce ${issue2.origin ?? "warto\u015B\u0107"} b\u0119dzie wynosi\u0107 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Nieprawid\u0142owy ci\u0105g znak\xF3w: musi zaczyna\u0107 si\u0119 od "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Nieprawid\u0142owy ci\u0105g znak\xF3w: musi ko\u0144czy\u0107 si\u0119 na "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Nieprawid\u0142owy ci\u0105g znak\xF3w: musi zawiera\u0107 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Nieprawid\u0142owy ci\u0105g znak\xF3w: musi odpowiada\u0107 wzorcowi ${_issue.pattern}`;
        return `Nieprawid\u0142ow(y/a/e) ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nieprawid\u0142owa liczba: musi by\u0107 wielokrotno\u015Bci\u0105 ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Nierozpoznane klucze${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Nieprawid\u0142owy klucz w ${issue2.origin}`;
      case "invalid_union":
        return "Nieprawid\u0142owe dane wej\u015Bciowe";
      case "invalid_element":
        return `Nieprawid\u0142owa warto\u015B\u0107 w ${issue2.origin}`;
      default:
        return `Nieprawid\u0142owe dane wej\u015Bciowe`;
    }
  };
};
function pl_default() {
  return {
    localeError: error35()
  };
}

// node_modules/zod/v4/locales/pt.js
var error36 = () => {
  const Sizable = {
    string: { unit: "caracteres", verb: "ter" },
    file: { unit: "bytes", verb: "ter" },
    array: { unit: "itens", verb: "ter" },
    set: { unit: "itens", verb: "ter" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "padr\xE3o",
    email: "endere\xE7o de e-mail",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data e hora ISO",
    date: "data ISO",
    time: "hora ISO",
    duration: "dura\xE7\xE3o ISO",
    ipv4: "endere\xE7o IPv4",
    ipv6: "endere\xE7o IPv6",
    cidrv4: "faixa de IPv4",
    cidrv6: "faixa de IPv6",
    base64: "texto codificado em base64",
    base64url: "URL codificada em base64",
    json_string: "texto JSON",
    e164: "n\xFAmero E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "n\xFAmero",
    null: "nulo"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Tipo inv\xE1lido: esperado instanceof ${issue2.expected}, recebido ${received}`;
        }
        return `Tipo inv\xE1lido: esperado ${expected}, recebido ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrada inv\xE1lida: esperado ${stringifyPrimitive(issue2.values[0])}`;
        return `Op\xE7\xE3o inv\xE1lida: esperada uma das ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Muito grande: esperado que ${issue2.origin ?? "valor"} tivesse ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementos"}`;
        return `Muito grande: esperado que ${issue2.origin ?? "valor"} fosse ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Muito pequeno: esperado que ${issue2.origin} tivesse ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Muito pequeno: esperado que ${issue2.origin} fosse ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Texto inv\xE1lido: deve come\xE7ar com "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Texto inv\xE1lido: deve terminar com "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Texto inv\xE1lido: deve incluir "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Texto inv\xE1lido: deve corresponder ao padr\xE3o ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} inv\xE1lido`;
      }
      case "not_multiple_of":
        return `N\xFAmero inv\xE1lido: deve ser m\xFAltiplo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chave${issue2.keys.length > 1 ? "s" : ""} desconhecida${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Chave inv\xE1lida em ${issue2.origin}`;
      case "invalid_union":
        return "Entrada inv\xE1lida";
      case "invalid_element":
        return `Valor inv\xE1lido em ${issue2.origin}`;
      default:
        return `Campo inv\xE1lido`;
    }
  };
};
function pt_default() {
  return {
    localeError: error36()
  };
}

// node_modules/zod/v4/locales/ro.js
var error37 = () => {
  const Sizable = {
    string: { unit: "caractere", verb: "s\u0103 aib\u0103" },
    file: { unit: "octe\u021Bi", verb: "s\u0103 aib\u0103" },
    array: { unit: "elemente", verb: "s\u0103 aib\u0103" },
    set: { unit: "elemente", verb: "s\u0103 aib\u0103" },
    map: { unit: "intr\u0103ri", verb: "s\u0103 aib\u0103" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "intrare",
    email: "adres\u0103 de email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "dat\u0103 \u0219i or\u0103 ISO",
    date: "dat\u0103 ISO",
    time: "or\u0103 ISO",
    duration: "durat\u0103 ISO",
    ipv4: "adres\u0103 IPv4",
    ipv6: "adres\u0103 IPv6",
    mac: "adres\u0103 MAC",
    cidrv4: "interval IPv4",
    cidrv6: "interval IPv6",
    base64: "\u0219ir codat base64",
    base64url: "\u0219ir codat base64url",
    json_string: "\u0219ir JSON",
    e164: "num\u0103r E.164",
    jwt: "JWT",
    template_literal: "intrare"
  };
  const TypeDictionary = {
    nan: "NaN",
    string: "\u0219ir",
    number: "num\u0103r",
    boolean: "boolean",
    function: "func\u021Bie",
    array: "matrice",
    object: "obiect",
    undefined: "nedefinit",
    symbol: "simbol",
    bigint: "num\u0103r mare",
    void: "void",
    never: "never",
    map: "hart\u0103",
    set: "set"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        return `Intrare invalid\u0103: a\u0219teptat ${expected}, primit ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Intrare invalid\u0103: a\u0219teptat ${stringifyPrimitive(issue2.values[0])}`;
        return `Op\u021Biune invalid\u0103: a\u0219teptat una dintre ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Prea mare: a\u0219teptat ca ${issue2.origin ?? "valoarea"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemente"}`;
        return `Prea mare: a\u0219teptat ca ${issue2.origin ?? "valoarea"} s\u0103 fie ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Prea mic: a\u0219teptat ca ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Prea mic: a\u0219teptat ca ${issue2.origin} s\u0103 fie ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u0218ir invalid: trebuie s\u0103 \xEEnceap\u0103 cu "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `\u0218ir invalid: trebuie s\u0103 se termine cu "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u0218ir invalid: trebuie s\u0103 includ\u0103 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u0218ir invalid: trebuie s\u0103 se potriveasc\u0103 cu modelul ${_issue.pattern}`;
        return `Format invalid: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Num\u0103r invalid: trebuie s\u0103 fie multiplu de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chei nerecunoscute: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Cheie invalid\u0103 \xEEn ${issue2.origin}`;
      case "invalid_union":
        return "Intrare invalid\u0103";
      case "invalid_element":
        return `Valoare invalid\u0103 \xEEn ${issue2.origin}`;
      default:
        return `Intrare invalid\u0103`;
    }
  };
};
function ro_default() {
  return {
    localeError: error37()
  };
}

// node_modules/zod/v4/locales/ru.js
function getRussianPlural(count, one, few, many) {
  const absCount = Math.abs(count);
  const lastDigit = absCount % 10;
  const lastTwoDigits = absCount % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return many;
  }
  if (lastDigit === 1) {
    return one;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }
  return many;
}
var error38 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "\u0441\u0438\u043C\u0432\u043E\u043B",
        few: "\u0441\u0438\u043C\u0432\u043E\u043B\u0430",
        many: "\u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432"
      },
      verb: "\u0438\u043C\u0435\u0442\u044C"
    },
    file: {
      unit: {
        one: "\u0431\u0430\u0439\u0442",
        few: "\u0431\u0430\u0439\u0442\u0430",
        many: "\u0431\u0430\u0439\u0442"
      },
      verb: "\u0438\u043C\u0435\u0442\u044C"
    },
    array: {
      unit: {
        one: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442",
        few: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430",
        many: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432"
      },
      verb: "\u0438\u043C\u0435\u0442\u044C"
    },
    set: {
      unit: {
        one: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442",
        few: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430",
        many: "\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432"
      },
      verb: "\u0438\u043C\u0435\u0442\u044C"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0432\u0432\u043E\u0434",
    email: "email \u0430\u0434\u0440\u0435\u0441",
    url: "URL",
    emoji: "\u044D\u043C\u043E\u0434\u0437\u0438",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u0434\u0430\u0442\u0430 \u0438 \u0432\u0440\u0435\u043C\u044F",
    date: "ISO \u0434\u0430\u0442\u0430",
    time: "ISO \u0432\u0440\u0435\u043C\u044F",
    duration: "ISO \u0434\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C",
    ipv4: "IPv4 \u0430\u0434\u0440\u0435\u0441",
    ipv6: "IPv6 \u0430\u0434\u0440\u0435\u0441",
    cidrv4: "IPv4 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D",
    cidrv6: "IPv6 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D",
    base64: "\u0441\u0442\u0440\u043E\u043A\u0430 \u0432 \u0444\u043E\u0440\u043C\u0430\u0442\u0435 base64",
    base64url: "\u0441\u0442\u0440\u043E\u043A\u0430 \u0432 \u0444\u043E\u0440\u043C\u0430\u0442\u0435 base64url",
    json_string: "JSON \u0441\u0442\u0440\u043E\u043A\u0430",
    e164: "\u043D\u043E\u043C\u0435\u0440 E.164",
    jwt: "JWT",
    template_literal: "\u0432\u0432\u043E\u0434"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0447\u0438\u0441\u043B\u043E",
    array: "\u043C\u0430\u0441\u0441\u0438\u0432"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0432\u0432\u043E\u0434: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C instanceof ${issue2.expected}, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E ${received}`;
        }
        return `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0432\u0432\u043E\u0434: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C ${expected}, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0432\u0432\u043E\u0434: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C ${stringifyPrimitive(issue2.values[0])}`;
        return `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0432\u0430\u0440\u0438\u0430\u043D\u0442: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0434\u043D\u043E \u0438\u0437 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getRussianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C, \u0447\u0442\u043E ${issue2.origin ?? "\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435"} \u0431\u0443\u0434\u0435\u0442 \u0438\u043C\u0435\u0442\u044C ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C, \u0447\u0442\u043E ${issue2.origin ?? "\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435"} \u0431\u0443\u0434\u0435\u0442 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getRussianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u0430\u043B\u0435\u043D\u044C\u043A\u043E\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C, \u0447\u0442\u043E ${issue2.origin} \u0431\u0443\u0434\u0435\u0442 \u0438\u043C\u0435\u0442\u044C ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u0430\u043B\u0435\u043D\u044C\u043A\u043E\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435: \u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C, \u0447\u0442\u043E ${issue2.origin} \u0431\u0443\u0434\u0435\u0442 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430: \u0434\u043E\u043B\u0436\u043D\u0430 \u043D\u0430\u0447\u0438\u043D\u0430\u0442\u044C\u0441\u044F \u0441 "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430: \u0434\u043E\u043B\u0436\u043D\u0430 \u0437\u0430\u043A\u0430\u043D\u0447\u0438\u0432\u0430\u0442\u044C\u0441\u044F \u043D\u0430 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430: \u0434\u043E\u043B\u0436\u043D\u0430 \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0441\u0442\u0440\u043E\u043A\u0430: \u0434\u043E\u043B\u0436\u043D\u0430 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u043E\u0432\u0430\u0442\u044C \u0448\u0430\u0431\u043B\u043E\u043D\u0443 ${_issue.pattern}`;
        return `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u041D\u0435\u0432\u0435\u0440\u043D\u043E\u0435 \u0447\u0438\u0441\u043B\u043E: \u0434\u043E\u043B\u0436\u043D\u043E \u0431\u044B\u0442\u044C \u043A\u0440\u0430\u0442\u043D\u044B\u043C ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u041D\u0435\u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u043D\u043D${issue2.keys.length > 1 ? "\u044B\u0435" : "\u044B\u0439"} \u043A\u043B\u044E\u0447${issue2.keys.length > 1 ? "\u0438" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u0432 ${issue2.origin}`;
      case "invalid_union":
        return "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0432\u0445\u043E\u0434\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435";
      case "invalid_element":
        return `\u041D\u0435\u0432\u0435\u0440\u043D\u043E\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u0432 ${issue2.origin}`;
      default:
        return `\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0435 \u0432\u0445\u043E\u0434\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435`;
    }
  };
};
function ru_default() {
  return {
    localeError: error38()
  };
}

// node_modules/zod/v4/locales/sl.js
var error39 = () => {
  const Sizable = {
    string: { unit: "znakov", verb: "imeti" },
    file: { unit: "bajtov", verb: "imeti" },
    array: { unit: "elementov", verb: "imeti" },
    set: { unit: "elementov", verb: "imeti" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "vnos",
    email: "e-po\u0161tni naslov",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum in \u010Das",
    date: "ISO datum",
    time: "ISO \u010Das",
    duration: "ISO trajanje",
    ipv4: "IPv4 naslov",
    ipv6: "IPv6 naslov",
    cidrv4: "obseg IPv4",
    cidrv6: "obseg IPv6",
    base64: "base64 kodiran niz",
    base64url: "base64url kodiran niz",
    json_string: "JSON niz",
    e164: "E.164 \u0161tevilka",
    jwt: "JWT",
    template_literal: "vnos"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0161tevilo",
    array: "tabela"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Neveljaven vnos: pri\u010Dakovano instanceof ${issue2.expected}, prejeto ${received}`;
        }
        return `Neveljaven vnos: pri\u010Dakovano ${expected}, prejeto ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neveljaven vnos: pri\u010Dakovano ${stringifyPrimitive(issue2.values[0])}`;
        return `Neveljavna mo\u017Enost: pri\u010Dakovano eno izmed ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Preveliko: pri\u010Dakovano, da bo ${issue2.origin ?? "vrednost"} imelo ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementov"}`;
        return `Preveliko: pri\u010Dakovano, da bo ${issue2.origin ?? "vrednost"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Premajhno: pri\u010Dakovano, da bo ${issue2.origin} imelo ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Premajhno: pri\u010Dakovano, da bo ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Neveljaven niz: mora se za\u010Deti z "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Neveljaven niz: mora se kon\u010Dati z "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neveljaven niz: mora vsebovati "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neveljaven niz: mora ustrezati vzorcu ${_issue.pattern}`;
        return `Neveljaven ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neveljavno \u0161tevilo: mora biti ve\u010Dkratnik ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Neprepoznan${issue2.keys.length > 1 ? "i klju\u010Di" : " klju\u010D"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neveljaven klju\u010D v ${issue2.origin}`;
      case "invalid_union":
        return "Neveljaven vnos";
      case "invalid_element":
        return `Neveljavna vrednost v ${issue2.origin}`;
      default:
        return "Neveljaven vnos";
    }
  };
};
function sl_default() {
  return {
    localeError: error39()
  };
}

// node_modules/zod/v4/locales/sv.js
var error40 = () => {
  const Sizable = {
    string: { unit: "tecken", verb: "att ha" },
    file: { unit: "bytes", verb: "att ha" },
    array: { unit: "objekt", verb: "att inneh\xE5lla" },
    set: { unit: "objekt", verb: "att inneh\xE5lla" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "regulj\xE4rt uttryck",
    email: "e-postadress",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-datum och tid",
    date: "ISO-datum",
    time: "ISO-tid",
    duration: "ISO-varaktighet",
    ipv4: "IPv4-intervall",
    ipv6: "IPv6-intervall",
    cidrv4: "IPv4-spektrum",
    cidrv6: "IPv6-spektrum",
    base64: "base64-kodad str\xE4ng",
    base64url: "base64url-kodad str\xE4ng",
    json_string: "JSON-str\xE4ng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "mall-literal"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "antal",
    array: "lista"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ogiltig inmatning: f\xF6rv\xE4ntat instanceof ${issue2.expected}, fick ${received}`;
        }
        return `Ogiltig inmatning: f\xF6rv\xE4ntat ${expected}, fick ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ogiltig inmatning: f\xF6rv\xE4ntat ${stringifyPrimitive(issue2.values[0])}`;
        return `Ogiltigt val: f\xF6rv\xE4ntade en av ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `F\xF6r stor(t): f\xF6rv\xE4ntade ${issue2.origin ?? "v\xE4rdet"} att ha ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "element"}`;
        }
        return `F\xF6r stor(t): f\xF6rv\xE4ntat ${issue2.origin ?? "v\xE4rdet"} att ha ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `F\xF6r lite(t): f\xF6rv\xE4ntade ${issue2.origin ?? "v\xE4rdet"} att ha ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `F\xF6r lite(t): f\xF6rv\xE4ntade ${issue2.origin ?? "v\xE4rdet"} att ha ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ogiltig str\xE4ng: m\xE5ste b\xF6rja med "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Ogiltig str\xE4ng: m\xE5ste sluta med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ogiltig str\xE4ng: m\xE5ste inneh\xE5lla "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ogiltig str\xE4ng: m\xE5ste matcha m\xF6nstret "${_issue.pattern}"`;
        return `Ogiltig(t) ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ogiltigt tal: m\xE5ste vara en multipel av ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Ok\xE4nda nycklar" : "Ok\xE4nd nyckel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ogiltig nyckel i ${issue2.origin ?? "v\xE4rdet"}`;
      case "invalid_union":
        return "Ogiltig input";
      case "invalid_element":
        return `Ogiltigt v\xE4rde i ${issue2.origin ?? "v\xE4rdet"}`;
      default:
        return `Ogiltig input`;
    }
  };
};
function sv_default() {
  return {
    localeError: error40()
  };
}

// node_modules/zod/v4/locales/ta.js
var error41 = () => {
  const Sizable = {
    string: { unit: "\u0B8E\u0BB4\u0BC1\u0BA4\u0BCD\u0BA4\u0BC1\u0B95\u0BCD\u0B95\u0BB3\u0BCD", verb: "\u0B95\u0BCA\u0BA3\u0BCD\u0B9F\u0BBF\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD" },
    file: { unit: "\u0BAA\u0BC8\u0B9F\u0BCD\u0B9F\u0BC1\u0B95\u0BB3\u0BCD", verb: "\u0B95\u0BCA\u0BA3\u0BCD\u0B9F\u0BBF\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD" },
    array: { unit: "\u0B89\u0BB1\u0BC1\u0BAA\u0BCD\u0BAA\u0BC1\u0B95\u0BB3\u0BCD", verb: "\u0B95\u0BCA\u0BA3\u0BCD\u0B9F\u0BBF\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD" },
    set: { unit: "\u0B89\u0BB1\u0BC1\u0BAA\u0BCD\u0BAA\u0BC1\u0B95\u0BB3\u0BCD", verb: "\u0B95\u0BCA\u0BA3\u0BCD\u0B9F\u0BBF\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0B89\u0BB3\u0BCD\u0BB3\u0BC0\u0B9F\u0BC1",
    email: "\u0BAE\u0BBF\u0BA9\u0BCD\u0BA9\u0B9E\u0BCD\u0B9A\u0BB2\u0BCD \u0BAE\u0BC1\u0B95\u0BB5\u0BB0\u0BBF",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u0BA4\u0BC7\u0BA4\u0BBF \u0BA8\u0BC7\u0BB0\u0BAE\u0BCD",
    date: "ISO \u0BA4\u0BC7\u0BA4\u0BBF",
    time: "ISO \u0BA8\u0BC7\u0BB0\u0BAE\u0BCD",
    duration: "ISO \u0B95\u0BBE\u0BB2 \u0B85\u0BB3\u0BB5\u0BC1",
    ipv4: "IPv4 \u0BAE\u0BC1\u0B95\u0BB5\u0BB0\u0BBF",
    ipv6: "IPv6 \u0BAE\u0BC1\u0B95\u0BB5\u0BB0\u0BBF",
    cidrv4: "IPv4 \u0BB5\u0BB0\u0BAE\u0BCD\u0BAA\u0BC1",
    cidrv6: "IPv6 \u0BB5\u0BB0\u0BAE\u0BCD\u0BAA\u0BC1",
    base64: "base64-encoded \u0B9A\u0BB0\u0BAE\u0BCD",
    base64url: "base64url-encoded \u0B9A\u0BB0\u0BAE\u0BCD",
    json_string: "JSON \u0B9A\u0BB0\u0BAE\u0BCD",
    e164: "E.164 \u0B8E\u0BA3\u0BCD",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0B8E\u0BA3\u0BCD",
    array: "\u0B85\u0BA3\u0BBF",
    null: "\u0BB5\u0BC6\u0BB1\u0BC1\u0BAE\u0BC8"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B89\u0BB3\u0BCD\u0BB3\u0BC0\u0B9F\u0BC1: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 instanceof ${issue2.expected}, \u0BAA\u0BC6\u0BB1\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${received}`;
        }
        return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B89\u0BB3\u0BCD\u0BB3\u0BC0\u0B9F\u0BC1: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${expected}, \u0BAA\u0BC6\u0BB1\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B89\u0BB3\u0BCD\u0BB3\u0BC0\u0B9F\u0BC1: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${stringifyPrimitive(issue2.values[0])}`;
        return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0BB5\u0BBF\u0BB0\u0BC1\u0BAA\u0BCD\u0BAA\u0BAE\u0BCD: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${joinValues(issue2.values, "|")} \u0B87\u0BB2\u0BCD \u0B92\u0BA9\u0BCD\u0BB1\u0BC1`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0BAE\u0BBF\u0B95 \u0BAA\u0BC6\u0BB0\u0BBF\u0BAF\u0BA4\u0BC1: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${issue2.origin ?? "\u0BAE\u0BA4\u0BBF\u0BAA\u0BCD\u0BAA\u0BC1"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u0B89\u0BB1\u0BC1\u0BAA\u0BCD\u0BAA\u0BC1\u0B95\u0BB3\u0BCD"} \u0B86\u0B95 \u0B87\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
        }
        return `\u0BAE\u0BBF\u0B95 \u0BAA\u0BC6\u0BB0\u0BBF\u0BAF\u0BA4\u0BC1: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${issue2.origin ?? "\u0BAE\u0BA4\u0BBF\u0BAA\u0BCD\u0BAA\u0BC1"} ${adj}${issue2.maximum.toString()} \u0B86\u0B95 \u0B87\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0BAE\u0BBF\u0B95\u0B9A\u0BCD \u0B9A\u0BBF\u0BB1\u0BBF\u0BAF\u0BA4\u0BC1: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} \u0B86\u0B95 \u0B87\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
        }
        return `\u0BAE\u0BBF\u0B95\u0B9A\u0BCD \u0B9A\u0BBF\u0BB1\u0BBF\u0BAF\u0BA4\u0BC1: \u0B8E\u0BA4\u0BBF\u0BB0\u0BCD\u0BAA\u0BBE\u0BB0\u0BCD\u0B95\u0BCD\u0B95\u0BAA\u0BCD\u0BAA\u0B9F\u0BCD\u0B9F\u0BA4\u0BC1 ${issue2.origin} ${adj}${issue2.minimum.toString()} \u0B86\u0B95 \u0B87\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B9A\u0BB0\u0BAE\u0BCD: "${_issue.prefix}" \u0B87\u0BB2\u0BCD \u0BA4\u0BCA\u0B9F\u0B99\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
        if (_issue.format === "ends_with")
          return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B9A\u0BB0\u0BAE\u0BCD: "${_issue.suffix}" \u0B87\u0BB2\u0BCD \u0BAE\u0BC1\u0B9F\u0BBF\u0BB5\u0B9F\u0BC8\u0BAF \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
        if (_issue.format === "includes")
          return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B9A\u0BB0\u0BAE\u0BCD: "${_issue.includes}" \u0B90 \u0B89\u0BB3\u0BCD\u0BB3\u0B9F\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
        if (_issue.format === "regex")
          return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B9A\u0BB0\u0BAE\u0BCD: ${_issue.pattern} \u0BAE\u0BC1\u0BB1\u0BC8\u0BAA\u0BBE\u0B9F\u0BCD\u0B9F\u0BC1\u0B9F\u0BA9\u0BCD \u0BAA\u0BCA\u0BB0\u0BC1\u0BA8\u0BCD\u0BA4 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
        return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B8E\u0BA3\u0BCD: ${issue2.divisor} \u0B87\u0BA9\u0BCD \u0BAA\u0BB2\u0BAE\u0BBE\u0B95 \u0B87\u0BB0\u0BC1\u0B95\u0BCD\u0B95 \u0BB5\u0BC7\u0BA3\u0BCD\u0B9F\u0BC1\u0BAE\u0BCD`;
      case "unrecognized_keys":
        return `\u0B85\u0B9F\u0BC8\u0BAF\u0BBE\u0BB3\u0BAE\u0BCD \u0BA4\u0BC6\u0BB0\u0BBF\u0BAF\u0BBE\u0BA4 \u0BB5\u0BBF\u0B9A\u0BC8${issue2.keys.length > 1 ? "\u0B95\u0BB3\u0BCD" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} \u0B87\u0BB2\u0BCD \u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0BB5\u0BBF\u0B9A\u0BC8`;
      case "invalid_union":
        return "\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B89\u0BB3\u0BCD\u0BB3\u0BC0\u0B9F\u0BC1";
      case "invalid_element":
        return `${issue2.origin} \u0B87\u0BB2\u0BCD \u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0BAE\u0BA4\u0BBF\u0BAA\u0BCD\u0BAA\u0BC1`;
      default:
        return `\u0BA4\u0BB5\u0BB1\u0BBE\u0BA9 \u0B89\u0BB3\u0BCD\u0BB3\u0BC0\u0B9F\u0BC1`;
    }
  };
};
function ta_default() {
  return {
    localeError: error41()
  };
}

// node_modules/zod/v4/locales/th.js
var error42 = () => {
  const Sizable = {
    string: { unit: "\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23", verb: "\u0E04\u0E27\u0E23\u0E21\u0E35" },
    file: { unit: "\u0E44\u0E1A\u0E15\u0E4C", verb: "\u0E04\u0E27\u0E23\u0E21\u0E35" },
    array: { unit: "\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23", verb: "\u0E04\u0E27\u0E23\u0E21\u0E35" },
    set: { unit: "\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23", verb: "\u0E04\u0E27\u0E23\u0E21\u0E35" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E17\u0E35\u0E48\u0E1B\u0E49\u0E2D\u0E19",
    email: "\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E2D\u0E35\u0E40\u0E21\u0E25",
    url: "URL",
    emoji: "\u0E2D\u0E34\u0E42\u0E21\u0E08\u0E34",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E40\u0E27\u0E25\u0E32\u0E41\u0E1A\u0E1A ISO",
    date: "\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E41\u0E1A\u0E1A ISO",
    time: "\u0E40\u0E27\u0E25\u0E32\u0E41\u0E1A\u0E1A ISO",
    duration: "\u0E0A\u0E48\u0E27\u0E07\u0E40\u0E27\u0E25\u0E32\u0E41\u0E1A\u0E1A ISO",
    ipv4: "\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48 IPv4",
    ipv6: "\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48 IPv6",
    cidrv4: "\u0E0A\u0E48\u0E27\u0E07 IP \u0E41\u0E1A\u0E1A IPv4",
    cidrv6: "\u0E0A\u0E48\u0E27\u0E07 IP \u0E41\u0E1A\u0E1A IPv6",
    base64: "\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E41\u0E1A\u0E1A Base64",
    base64url: "\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E41\u0E1A\u0E1A Base64 \u0E2A\u0E33\u0E2B\u0E23\u0E31\u0E1A URL",
    json_string: "\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E41\u0E1A\u0E1A JSON",
    e164: "\u0E40\u0E1A\u0E2D\u0E23\u0E4C\u0E42\u0E17\u0E23\u0E28\u0E31\u0E1E\u0E17\u0E4C\u0E23\u0E30\u0E2B\u0E27\u0E48\u0E32\u0E07\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28 (E.164)",
    jwt: "\u0E42\u0E17\u0E40\u0E04\u0E19 JWT",
    template_literal: "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E17\u0E35\u0E48\u0E1B\u0E49\u0E2D\u0E19"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0E15\u0E31\u0E27\u0E40\u0E25\u0E02",
    array: "\u0E2D\u0E32\u0E23\u0E4C\u0E40\u0E23\u0E22\u0E4C (Array)",
    null: "\u0E44\u0E21\u0E48\u0E21\u0E35\u0E04\u0E48\u0E32 (null)"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E04\u0E27\u0E23\u0E40\u0E1B\u0E47\u0E19 instanceof ${issue2.expected} \u0E41\u0E15\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A ${received}`;
        }
        return `\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E04\u0E27\u0E23\u0E40\u0E1B\u0E47\u0E19 ${expected} \u0E41\u0E15\u0E48\u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u0E04\u0E48\u0E32\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E04\u0E27\u0E23\u0E40\u0E1B\u0E47\u0E19 ${stringifyPrimitive(issue2.values[0])}`;
        return `\u0E15\u0E31\u0E27\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E04\u0E27\u0E23\u0E40\u0E1B\u0E47\u0E19\u0E2B\u0E19\u0E36\u0E48\u0E07\u0E43\u0E19 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "\u0E44\u0E21\u0E48\u0E40\u0E01\u0E34\u0E19" : "\u0E19\u0E49\u0E2D\u0E22\u0E01\u0E27\u0E48\u0E32";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u0E40\u0E01\u0E34\u0E19\u0E01\u0E33\u0E2B\u0E19\u0E14: ${issue2.origin ?? "\u0E04\u0E48\u0E32"} \u0E04\u0E27\u0E23\u0E21\u0E35${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23"}`;
        return `\u0E40\u0E01\u0E34\u0E19\u0E01\u0E33\u0E2B\u0E19\u0E14: ${issue2.origin ?? "\u0E04\u0E48\u0E32"} \u0E04\u0E27\u0E23\u0E21\u0E35${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22" : "\u0E21\u0E32\u0E01\u0E01\u0E27\u0E48\u0E32";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0E19\u0E49\u0E2D\u0E22\u0E01\u0E27\u0E48\u0E32\u0E01\u0E33\u0E2B\u0E19\u0E14: ${issue2.origin} \u0E04\u0E27\u0E23\u0E21\u0E35${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u0E19\u0E49\u0E2D\u0E22\u0E01\u0E27\u0E48\u0E32\u0E01\u0E33\u0E2B\u0E19\u0E14: ${issue2.origin} \u0E04\u0E27\u0E23\u0E21\u0E35${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E02\u0E36\u0E49\u0E19\u0E15\u0E49\u0E19\u0E14\u0E49\u0E27\u0E22 "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E25\u0E07\u0E17\u0E49\u0E32\u0E22\u0E14\u0E49\u0E27\u0E22 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E21\u0E35 "${_issue.includes}" \u0E2D\u0E22\u0E39\u0E48\u0E43\u0E19\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21`;
        if (_issue.format === "regex")
          return `\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E15\u0E49\u0E2D\u0E07\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14 ${_issue.pattern}`;
        return `\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u0E15\u0E31\u0E27\u0E40\u0E25\u0E02\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E15\u0E49\u0E2D\u0E07\u0E40\u0E1B\u0E47\u0E19\u0E08\u0E33\u0E19\u0E27\u0E19\u0E17\u0E35\u0E48\u0E2B\u0E32\u0E23\u0E14\u0E49\u0E27\u0E22 ${issue2.divisor} \u0E44\u0E14\u0E49\u0E25\u0E07\u0E15\u0E31\u0E27`;
      case "unrecognized_keys":
        return `\u0E1E\u0E1A\u0E04\u0E35\u0E22\u0E4C\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E23\u0E39\u0E49\u0E08\u0E31\u0E01: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u0E04\u0E35\u0E22\u0E4C\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E43\u0E19 ${issue2.origin}`;
      case "invalid_union":
        return "\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07: \u0E44\u0E21\u0E48\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E23\u0E39\u0E1B\u0E41\u0E1A\u0E1A\u0E22\u0E39\u0E40\u0E19\u0E35\u0E22\u0E19\u0E17\u0E35\u0E48\u0E01\u0E33\u0E2B\u0E19\u0E14\u0E44\u0E27\u0E49";
      case "invalid_element":
        return `\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07\u0E43\u0E19 ${issue2.origin}`;
      default:
        return `\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25\u0E44\u0E21\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07`;
    }
  };
};
function th_default() {
  return {
    localeError: error42()
  };
}

// node_modules/zod/v4/locales/tr.js
var error43 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "olmal\u0131" },
    file: { unit: "bayt", verb: "olmal\u0131" },
    array: { unit: "\xF6\u011Fe", verb: "olmal\u0131" },
    set: { unit: "\xF6\u011Fe", verb: "olmal\u0131" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "girdi",
    email: "e-posta adresi",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO tarih ve saat",
    date: "ISO tarih",
    time: "ISO saat",
    duration: "ISO s\xFCre",
    ipv4: "IPv4 adresi",
    ipv6: "IPv6 adresi",
    cidrv4: "IPv4 aral\u0131\u011F\u0131",
    cidrv6: "IPv6 aral\u0131\u011F\u0131",
    base64: "base64 ile \u015Fifrelenmi\u015F metin",
    base64url: "base64url ile \u015Fifrelenmi\u015F metin",
    json_string: "JSON dizesi",
    e164: "E.164 say\u0131s\u0131",
    jwt: "JWT",
    template_literal: "\u015Eablon dizesi"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Ge\xE7ersiz de\u011Fer: beklenen instanceof ${issue2.expected}, al\u0131nan ${received}`;
        }
        return `Ge\xE7ersiz de\u011Fer: beklenen ${expected}, al\u0131nan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ge\xE7ersiz de\u011Fer: beklenen ${stringifyPrimitive(issue2.values[0])}`;
        return `Ge\xE7ersiz se\xE7enek: a\u015Fa\u011F\u0131dakilerden biri olmal\u0131: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\xC7ok b\xFCy\xFCk: beklenen ${issue2.origin ?? "de\u011Fer"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\xF6\u011Fe"}`;
        return `\xC7ok b\xFCy\xFCk: beklenen ${issue2.origin ?? "de\u011Fer"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\xC7ok k\xFC\xE7\xFCk: beklenen ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `\xC7ok k\xFC\xE7\xFCk: beklenen ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ge\xE7ersiz metin: "${_issue.prefix}" ile ba\u015Flamal\u0131`;
        if (_issue.format === "ends_with")
          return `Ge\xE7ersiz metin: "${_issue.suffix}" ile bitmeli`;
        if (_issue.format === "includes")
          return `Ge\xE7ersiz metin: "${_issue.includes}" i\xE7ermeli`;
        if (_issue.format === "regex")
          return `Ge\xE7ersiz metin: ${_issue.pattern} desenine uymal\u0131`;
        return `Ge\xE7ersiz ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ge\xE7ersiz say\u0131: ${issue2.divisor} ile tam b\xF6l\xFCnebilmeli`;
      case "unrecognized_keys":
        return `Tan\u0131nmayan anahtar${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} i\xE7inde ge\xE7ersiz anahtar`;
      case "invalid_union":
        return "Ge\xE7ersiz de\u011Fer";
      case "invalid_element":
        return `${issue2.origin} i\xE7inde ge\xE7ersiz de\u011Fer`;
      default:
        return `Ge\xE7ersiz de\u011Fer`;
    }
  };
};
function tr_default() {
  return {
    localeError: error43()
  };
}

// node_modules/zod/v4/locales/uk.js
var error44 = () => {
  const Sizable = {
    string: { unit: "\u0441\u0438\u043C\u0432\u043E\u043B\u0456\u0432", verb: "\u043C\u0430\u0442\u0438\u043C\u0435" },
    file: { unit: "\u0431\u0430\u0439\u0442\u0456\u0432", verb: "\u043C\u0430\u0442\u0438\u043C\u0435" },
    array: { unit: "\u0435\u043B\u0435\u043C\u0435\u043D\u0442\u0456\u0432", verb: "\u043C\u0430\u0442\u0438\u043C\u0435" },
    set: { unit: "\u0435\u043B\u0435\u043C\u0435\u043D\u0442\u0456\u0432", verb: "\u043C\u0430\u0442\u0438\u043C\u0435" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456",
    email: "\u0430\u0434\u0440\u0435\u0441\u0430 \u0435\u043B\u0435\u043A\u0442\u0440\u043E\u043D\u043D\u043E\u0457 \u043F\u043E\u0448\u0442\u0438",
    url: "URL",
    emoji: "\u0435\u043C\u043E\u0434\u0437\u0456",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\u0434\u0430\u0442\u0430 \u0442\u0430 \u0447\u0430\u0441 ISO",
    date: "\u0434\u0430\u0442\u0430 ISO",
    time: "\u0447\u0430\u0441 ISO",
    duration: "\u0442\u0440\u0438\u0432\u0430\u043B\u0456\u0441\u0442\u044C ISO",
    ipv4: "\u0430\u0434\u0440\u0435\u0441\u0430 IPv4",
    ipv6: "\u0430\u0434\u0440\u0435\u0441\u0430 IPv6",
    cidrv4: "\u0434\u0456\u0430\u043F\u0430\u0437\u043E\u043D IPv4",
    cidrv6: "\u0434\u0456\u0430\u043F\u0430\u0437\u043E\u043D IPv6",
    base64: "\u0440\u044F\u0434\u043E\u043A \u0443 \u043A\u043E\u0434\u0443\u0432\u0430\u043D\u043D\u0456 base64",
    base64url: "\u0440\u044F\u0434\u043E\u043A \u0443 \u043A\u043E\u0434\u0443\u0432\u0430\u043D\u043D\u0456 base64url",
    json_string: "\u0440\u044F\u0434\u043E\u043A JSON",
    e164: "\u043D\u043E\u043C\u0435\u0440 E.164",
    jwt: "JWT",
    template_literal: "\u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0447\u0438\u0441\u043B\u043E",
    array: "\u043C\u0430\u0441\u0438\u0432"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0456 \u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F instanceof ${issue2.expected}, \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E ${received}`;
        }
        return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0456 \u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F ${expected}, \u043E\u0442\u0440\u0438\u043C\u0430\u043D\u043E ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0456 \u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F ${stringifyPrimitive(issue2.values[0])}`;
        return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0430 \u043E\u043F\u0446\u0456\u044F: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F \u043E\u0434\u043D\u0435 \u0437 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u0417\u0430\u043D\u0430\u0434\u0442\u043E \u0432\u0435\u043B\u0438\u043A\u0435: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F, \u0449\u043E ${issue2.origin ?? "\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u0435\u043B\u0435\u043C\u0435\u043D\u0442\u0456\u0432"}`;
        return `\u0417\u0430\u043D\u0430\u0434\u0442\u043E \u0432\u0435\u043B\u0438\u043A\u0435: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F, \u0449\u043E ${issue2.origin ?? "\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F"} \u0431\u0443\u0434\u0435 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0417\u0430\u043D\u0430\u0434\u0442\u043E \u043C\u0430\u043B\u0435: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F, \u0449\u043E ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u0417\u0430\u043D\u0430\u0434\u0442\u043E \u043C\u0430\u043B\u0435: \u043E\u0447\u0456\u043A\u0443\u0454\u0442\u044C\u0441\u044F, \u0449\u043E ${issue2.origin} \u0431\u0443\u0434\u0435 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 \u0440\u044F\u0434\u043E\u043A: \u043F\u043E\u0432\u0438\u043D\u0435\u043D \u043F\u043E\u0447\u0438\u043D\u0430\u0442\u0438\u0441\u044F \u0437 "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 \u0440\u044F\u0434\u043E\u043A: \u043F\u043E\u0432\u0438\u043D\u0435\u043D \u0437\u0430\u043A\u0456\u043D\u0447\u0443\u0432\u0430\u0442\u0438\u0441\u044F \u043D\u0430 "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 \u0440\u044F\u0434\u043E\u043A: \u043F\u043E\u0432\u0438\u043D\u0435\u043D \u043C\u0456\u0441\u0442\u0438\u0442\u0438 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 \u0440\u044F\u0434\u043E\u043A: \u043F\u043E\u0432\u0438\u043D\u0435\u043D \u0432\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u0430\u0442\u0438 \u0448\u0430\u0431\u043B\u043E\u043D\u0443 ${_issue.pattern}`;
        return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0435 \u0447\u0438\u0441\u043B\u043E: \u043F\u043E\u0432\u0438\u043D\u043D\u043E \u0431\u0443\u0442\u0438 \u043A\u0440\u0430\u0442\u043D\u0438\u043C ${issue2.divisor}`;
      case "unrecognized_keys":
        return `\u041D\u0435\u0440\u043E\u0437\u043F\u0456\u0437\u043D\u0430\u043D\u0438\u0439 \u043A\u043B\u044E\u0447${issue2.keys.length > 1 ? "\u0456" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0438\u0439 \u043A\u043B\u044E\u0447 \u0443 ${issue2.origin}`;
      case "invalid_union":
        return "\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0456 \u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456";
      case "invalid_element":
        return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044F \u0443 ${issue2.origin}`;
      default:
        return `\u041D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0456 \u0432\u0445\u0456\u0434\u043D\u0456 \u0434\u0430\u043D\u0456`;
    }
  };
};
function uk_default() {
  return {
    localeError: error44()
  };
}

// node_modules/zod/v4/locales/ua.js
function ua_default() {
  return uk_default();
}

// node_modules/zod/v4/locales/ur.js
var error45 = () => {
  const Sizable = {
    string: { unit: "\u062D\u0631\u0648\u0641", verb: "\u06C1\u0648\u0646\u0627" },
    file: { unit: "\u0628\u0627\u0626\u0679\u0633", verb: "\u06C1\u0648\u0646\u0627" },
    array: { unit: "\u0622\u0626\u0679\u0645\u0632", verb: "\u06C1\u0648\u0646\u0627" },
    set: { unit: "\u0622\u0626\u0679\u0645\u0632", verb: "\u06C1\u0648\u0646\u0627" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0627\u0646 \u067E\u0679",
    email: "\u0627\u06CC \u0645\u06CC\u0644 \u0627\u06CC\u0688\u0631\u06CC\u0633",
    url: "\u06CC\u0648 \u0622\u0631 \u0627\u06CC\u0644",
    emoji: "\u0627\u06CC\u0645\u0648\u062C\u06CC",
    uuid: "\u06CC\u0648 \u06CC\u0648 \u0622\u0626\u06CC \u0688\u06CC",
    uuidv4: "\u06CC\u0648 \u06CC\u0648 \u0622\u0626\u06CC \u0688\u06CC \u0648\u06CC 4",
    uuidv6: "\u06CC\u0648 \u06CC\u0648 \u0622\u0626\u06CC \u0688\u06CC \u0648\u06CC 6",
    nanoid: "\u0646\u06CC\u0646\u0648 \u0622\u0626\u06CC \u0688\u06CC",
    guid: "\u062C\u06CC \u06CC\u0648 \u0622\u0626\u06CC \u0688\u06CC",
    cuid: "\u0633\u06CC \u06CC\u0648 \u0622\u0626\u06CC \u0688\u06CC",
    cuid2: "\u0633\u06CC \u06CC\u0648 \u0622\u0626\u06CC \u0688\u06CC 2",
    ulid: "\u06CC\u0648 \u0627\u06CC\u0644 \u0622\u0626\u06CC \u0688\u06CC",
    xid: "\u0627\u06CC\u06A9\u0633 \u0622\u0626\u06CC \u0688\u06CC",
    ksuid: "\u06A9\u06D2 \u0627\u06CC\u0633 \u06CC\u0648 \u0622\u0626\u06CC \u0688\u06CC",
    datetime: "\u0622\u0626\u06CC \u0627\u06CC\u0633 \u0627\u0648 \u0688\u06CC\u0679 \u0679\u0627\u0626\u0645",
    date: "\u0622\u0626\u06CC \u0627\u06CC\u0633 \u0627\u0648 \u062A\u0627\u0631\u06CC\u062E",
    time: "\u0622\u0626\u06CC \u0627\u06CC\u0633 \u0627\u0648 \u0648\u0642\u062A",
    duration: "\u0622\u0626\u06CC \u0627\u06CC\u0633 \u0627\u0648 \u0645\u062F\u062A",
    ipv4: "\u0622\u0626\u06CC \u067E\u06CC \u0648\u06CC 4 \u0627\u06CC\u0688\u0631\u06CC\u0633",
    ipv6: "\u0622\u0626\u06CC \u067E\u06CC \u0648\u06CC 6 \u0627\u06CC\u0688\u0631\u06CC\u0633",
    cidrv4: "\u0622\u0626\u06CC \u067E\u06CC \u0648\u06CC 4 \u0631\u06CC\u0646\u062C",
    cidrv6: "\u0622\u0626\u06CC \u067E\u06CC \u0648\u06CC 6 \u0631\u06CC\u0646\u062C",
    base64: "\u0628\u06CC\u0633 64 \u0627\u0646 \u06A9\u0648\u0688\u0688 \u0633\u0679\u0631\u0646\u06AF",
    base64url: "\u0628\u06CC\u0633 64 \u06CC\u0648 \u0622\u0631 \u0627\u06CC\u0644 \u0627\u0646 \u06A9\u0648\u0688\u0688 \u0633\u0679\u0631\u0646\u06AF",
    json_string: "\u062C\u06D2 \u0627\u06CC\u0633 \u0627\u0648 \u0627\u06CC\u0646 \u0633\u0679\u0631\u0646\u06AF",
    e164: "\u0627\u06CC 164 \u0646\u0645\u0628\u0631",
    jwt: "\u062C\u06D2 \u0688\u0628\u0644\u06CC\u0648 \u0679\u06CC",
    template_literal: "\u0627\u0646 \u067E\u0679"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u0646\u0645\u0628\u0631",
    array: "\u0622\u0631\u06D2",
    null: "\u0646\u0644"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u063A\u0644\u0637 \u0627\u0646 \u067E\u0679: instanceof ${issue2.expected} \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u0627\u060C ${received} \u0645\u0648\u0635\u0648\u0644 \u06C1\u0648\u0627`;
        }
        return `\u063A\u0644\u0637 \u0627\u0646 \u067E\u0679: ${expected} \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u0627\u060C ${received} \u0645\u0648\u0635\u0648\u0644 \u06C1\u0648\u0627`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u063A\u0644\u0637 \u0627\u0646 \u067E\u0679: ${stringifyPrimitive(issue2.values[0])} \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u0627`;
        return `\u063A\u0644\u0637 \u0622\u067E\u0634\u0646: ${joinValues(issue2.values, "|")} \u0645\u06CC\u06BA \u0633\u06D2 \u0627\u06CC\u06A9 \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u0627`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u0628\u06C1\u062A \u0628\u0691\u0627: ${issue2.origin ?? "\u0648\u06CC\u0644\u06CC\u0648"} \u06A9\u06D2 ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u0639\u0646\u0627\u0635\u0631"} \u06C1\u0648\u0646\u06D2 \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u06D2`;
        return `\u0628\u06C1\u062A \u0628\u0691\u0627: ${issue2.origin ?? "\u0648\u06CC\u0644\u06CC\u0648"} \u06A9\u0627 ${adj}${issue2.maximum.toString()} \u06C1\u0648\u0646\u0627 \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u0627`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u0628\u06C1\u062A \u0686\u06BE\u0648\u0679\u0627: ${issue2.origin} \u06A9\u06D2 ${adj}${issue2.minimum.toString()} ${sizing.unit} \u06C1\u0648\u0646\u06D2 \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u06D2`;
        }
        return `\u0628\u06C1\u062A \u0686\u06BE\u0648\u0679\u0627: ${issue2.origin} \u06A9\u0627 ${adj}${issue2.minimum.toString()} \u06C1\u0648\u0646\u0627 \u0645\u062A\u0648\u0642\u0639 \u062A\u06BE\u0627`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u063A\u0644\u0637 \u0633\u0679\u0631\u0646\u06AF: "${_issue.prefix}" \u0633\u06D2 \u0634\u0631\u0648\u0639 \u06C1\u0648\u0646\u0627 \u0686\u0627\u06C1\u06CC\u06D2`;
        }
        if (_issue.format === "ends_with")
          return `\u063A\u0644\u0637 \u0633\u0679\u0631\u0646\u06AF: "${_issue.suffix}" \u067E\u0631 \u062E\u062A\u0645 \u06C1\u0648\u0646\u0627 \u0686\u0627\u06C1\u06CC\u06D2`;
        if (_issue.format === "includes")
          return `\u063A\u0644\u0637 \u0633\u0679\u0631\u0646\u06AF: "${_issue.includes}" \u0634\u0627\u0645\u0644 \u06C1\u0648\u0646\u0627 \u0686\u0627\u06C1\u06CC\u06D2`;
        if (_issue.format === "regex")
          return `\u063A\u0644\u0637 \u0633\u0679\u0631\u0646\u06AF: \u067E\u06CC\u0679\u0631\u0646 ${_issue.pattern} \u0633\u06D2 \u0645\u06CC\u0686 \u06C1\u0648\u0646\u0627 \u0686\u0627\u06C1\u06CC\u06D2`;
        return `\u063A\u0644\u0637 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u063A\u0644\u0637 \u0646\u0645\u0628\u0631: ${issue2.divisor} \u06A9\u0627 \u0645\u0636\u0627\u0639\u0641 \u06C1\u0648\u0646\u0627 \u0686\u0627\u06C1\u06CC\u06D2`;
      case "unrecognized_keys":
        return `\u063A\u06CC\u0631 \u062A\u0633\u0644\u06CC\u0645 \u0634\u062F\u06C1 \u06A9\u06CC${issue2.keys.length > 1 ? "\u0632" : ""}: ${joinValues(issue2.keys, "\u060C ")}`;
      case "invalid_key":
        return `${issue2.origin} \u0645\u06CC\u06BA \u063A\u0644\u0637 \u06A9\u06CC`;
      case "invalid_union":
        return "\u063A\u0644\u0637 \u0627\u0646 \u067E\u0679";
      case "invalid_element":
        return `${issue2.origin} \u0645\u06CC\u06BA \u063A\u0644\u0637 \u0648\u06CC\u0644\u06CC\u0648`;
      default:
        return `\u063A\u0644\u0637 \u0627\u0646 \u067E\u0679`;
    }
  };
};
function ur_default() {
  return {
    localeError: error45()
  };
}

// node_modules/zod/v4/locales/uz.js
var error46 = () => {
  const Sizable = {
    string: { unit: "belgi", verb: "bo\u2018lishi kerak" },
    file: { unit: "bayt", verb: "bo\u2018lishi kerak" },
    array: { unit: "element", verb: "bo\u2018lishi kerak" },
    set: { unit: "element", verb: "bo\u2018lishi kerak" },
    map: { unit: "yozuv", verb: "bo\u2018lishi kerak" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "kirish",
    email: "elektron pochta manzili",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO sana va vaqti",
    date: "ISO sana",
    time: "ISO vaqt",
    duration: "ISO davomiylik",
    ipv4: "IPv4 manzil",
    ipv6: "IPv6 manzil",
    mac: "MAC manzil",
    cidrv4: "IPv4 diapazon",
    cidrv6: "IPv6 diapazon",
    base64: "base64 kodlangan satr",
    base64url: "base64url kodlangan satr",
    json_string: "JSON satr",
    e164: "E.164 raqam",
    jwt: "JWT",
    template_literal: "kirish"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "raqam",
    array: "massiv"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `Noto\u2018g\u2018ri kirish: kutilgan instanceof ${issue2.expected}, qabul qilingan ${received}`;
        }
        return `Noto\u2018g\u2018ri kirish: kutilgan ${expected}, qabul qilingan ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Noto\u2018g\u2018ri kirish: kutilgan ${stringifyPrimitive(issue2.values[0])}`;
        return `Noto\u2018g\u2018ri variant: quyidagilardan biri kutilgan ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Juda katta: kutilgan ${issue2.origin ?? "qiymat"} ${adj}${issue2.maximum.toString()} ${sizing.unit} ${sizing.verb}`;
        return `Juda katta: kutilgan ${issue2.origin ?? "qiymat"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Juda kichik: kutilgan ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} ${sizing.verb}`;
        }
        return `Juda kichik: kutilgan ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Noto\u2018g\u2018ri satr: "${_issue.prefix}" bilan boshlanishi kerak`;
        if (_issue.format === "ends_with")
          return `Noto\u2018g\u2018ri satr: "${_issue.suffix}" bilan tugashi kerak`;
        if (_issue.format === "includes")
          return `Noto\u2018g\u2018ri satr: "${_issue.includes}" ni o\u2018z ichiga olishi kerak`;
        if (_issue.format === "regex")
          return `Noto\u2018g\u2018ri satr: ${_issue.pattern} shabloniga mos kelishi kerak`;
        return `Noto\u2018g\u2018ri ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Noto\u2018g\u2018ri raqam: ${issue2.divisor} ning karralisi bo\u2018lishi kerak`;
      case "unrecognized_keys":
        return `Noma\u2019lum kalit${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} dagi kalit noto\u2018g\u2018ri`;
      case "invalid_union":
        return "Noto\u2018g\u2018ri kirish";
      case "invalid_element":
        return `${issue2.origin} da noto\u2018g\u2018ri qiymat`;
      default:
        return `Noto\u2018g\u2018ri kirish`;
    }
  };
};
function uz_default() {
  return {
    localeError: error46()
  };
}

// node_modules/zod/v4/locales/vi.js
var error47 = () => {
  const Sizable = {
    string: { unit: "k\xFD t\u1EF1", verb: "c\xF3" },
    file: { unit: "byte", verb: "c\xF3" },
    array: { unit: "ph\u1EA7n t\u1EED", verb: "c\xF3" },
    set: { unit: "ph\u1EA7n t\u1EED", verb: "c\xF3" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u0111\u1EA7u v\xE0o",
    email: "\u0111\u1ECBa ch\u1EC9 email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ng\xE0y gi\u1EDD ISO",
    date: "ng\xE0y ISO",
    time: "gi\u1EDD ISO",
    duration: "kho\u1EA3ng th\u1EDDi gian ISO",
    ipv4: "\u0111\u1ECBa ch\u1EC9 IPv4",
    ipv6: "\u0111\u1ECBa ch\u1EC9 IPv6",
    cidrv4: "d\u1EA3i IPv4",
    cidrv6: "d\u1EA3i IPv6",
    base64: "chu\u1ED7i m\xE3 h\xF3a base64",
    base64url: "chu\u1ED7i m\xE3 h\xF3a base64url",
    json_string: "chu\u1ED7i JSON",
    e164: "s\u1ED1 E.164",
    jwt: "JWT",
    template_literal: "\u0111\u1EA7u v\xE0o"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "s\u1ED1",
    array: "m\u1EA3ng"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u0110\u1EA7u v\xE0o kh\xF4ng h\u1EE3p l\u1EC7: mong \u0111\u1EE3i instanceof ${issue2.expected}, nh\u1EADn \u0111\u01B0\u1EE3c ${received}`;
        }
        return `\u0110\u1EA7u v\xE0o kh\xF4ng h\u1EE3p l\u1EC7: mong \u0111\u1EE3i ${expected}, nh\u1EADn \u0111\u01B0\u1EE3c ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u0110\u1EA7u v\xE0o kh\xF4ng h\u1EE3p l\u1EC7: mong \u0111\u1EE3i ${stringifyPrimitive(issue2.values[0])}`;
        return `T\xF9y ch\u1ECDn kh\xF4ng h\u1EE3p l\u1EC7: mong \u0111\u1EE3i m\u1ED9t trong c\xE1c gi\xE1 tr\u1ECB ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Qu\xE1 l\u1EDBn: mong \u0111\u1EE3i ${issue2.origin ?? "gi\xE1 tr\u1ECB"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "ph\u1EA7n t\u1EED"}`;
        return `Qu\xE1 l\u1EDBn: mong \u0111\u1EE3i ${issue2.origin ?? "gi\xE1 tr\u1ECB"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Qu\xE1 nh\u1ECF: mong \u0111\u1EE3i ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Qu\xE1 nh\u1ECF: mong \u0111\u1EE3i ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Chu\u1ED7i kh\xF4ng h\u1EE3p l\u1EC7: ph\u1EA3i b\u1EAFt \u0111\u1EA7u b\u1EB1ng "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Chu\u1ED7i kh\xF4ng h\u1EE3p l\u1EC7: ph\u1EA3i k\u1EBFt th\xFAc b\u1EB1ng "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Chu\u1ED7i kh\xF4ng h\u1EE3p l\u1EC7: ph\u1EA3i bao g\u1ED3m "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Chu\u1ED7i kh\xF4ng h\u1EE3p l\u1EC7: ph\u1EA3i kh\u1EDBp v\u1EDBi m\u1EABu ${_issue.pattern}`;
        return `${FormatDictionary[_issue.format] ?? issue2.format} kh\xF4ng h\u1EE3p l\u1EC7`;
      }
      case "not_multiple_of":
        return `S\u1ED1 kh\xF4ng h\u1EE3p l\u1EC7: ph\u1EA3i l\xE0 b\u1ED9i s\u1ED1 c\u1EE7a ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Kh\xF3a kh\xF4ng \u0111\u01B0\u1EE3c nh\u1EADn d\u1EA1ng: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Kh\xF3a kh\xF4ng h\u1EE3p l\u1EC7 trong ${issue2.origin}`;
      case "invalid_union":
        return "\u0110\u1EA7u v\xE0o kh\xF4ng h\u1EE3p l\u1EC7";
      case "invalid_element":
        return `Gi\xE1 tr\u1ECB kh\xF4ng h\u1EE3p l\u1EC7 trong ${issue2.origin}`;
      default:
        return `\u0110\u1EA7u v\xE0o kh\xF4ng h\u1EE3p l\u1EC7`;
    }
  };
};
function vi_default() {
  return {
    localeError: error47()
  };
}

// node_modules/zod/v4/locales/zh-CN.js
var error48 = () => {
  const Sizable = {
    string: { unit: "\u5B57\u7B26", verb: "\u5305\u542B" },
    file: { unit: "\u5B57\u8282", verb: "\u5305\u542B" },
    array: { unit: "\u9879", verb: "\u5305\u542B" },
    set: { unit: "\u9879", verb: "\u5305\u542B" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u8F93\u5165",
    email: "\u7535\u5B50\u90AE\u4EF6",
    url: "URL",
    emoji: "\u8868\u60C5\u7B26\u53F7",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO\u65E5\u671F\u65F6\u95F4",
    date: "ISO\u65E5\u671F",
    time: "ISO\u65F6\u95F4",
    duration: "ISO\u65F6\u957F",
    ipv4: "IPv4\u5730\u5740",
    ipv6: "IPv6\u5730\u5740",
    cidrv4: "IPv4\u7F51\u6BB5",
    cidrv6: "IPv6\u7F51\u6BB5",
    base64: "base64\u7F16\u7801\u5B57\u7B26\u4E32",
    base64url: "base64url\u7F16\u7801\u5B57\u7B26\u4E32",
    json_string: "JSON\u5B57\u7B26\u4E32",
    e164: "E.164\u53F7\u7801",
    jwt: "JWT",
    template_literal: "\u8F93\u5165"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "\u6570\u5B57",
    array: "\u6570\u7EC4",
    null: "\u7A7A\u503C(null)"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u65E0\u6548\u8F93\u5165\uFF1A\u671F\u671B instanceof ${issue2.expected}\uFF0C\u5B9E\u9645\u63A5\u6536 ${received}`;
        }
        return `\u65E0\u6548\u8F93\u5165\uFF1A\u671F\u671B ${expected}\uFF0C\u5B9E\u9645\u63A5\u6536 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u65E0\u6548\u8F93\u5165\uFF1A\u671F\u671B ${stringifyPrimitive(issue2.values[0])}`;
        return `\u65E0\u6548\u9009\u9879\uFF1A\u671F\u671B\u4EE5\u4E0B\u4E4B\u4E00 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u6570\u503C\u8FC7\u5927\uFF1A\u671F\u671B ${issue2.origin ?? "\u503C"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u4E2A\u5143\u7D20"}`;
        return `\u6570\u503C\u8FC7\u5927\uFF1A\u671F\u671B ${issue2.origin ?? "\u503C"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u6570\u503C\u8FC7\u5C0F\uFF1A\u671F\u671B ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u6570\u503C\u8FC7\u5C0F\uFF1A\u671F\u671B ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u65E0\u6548\u5B57\u7B26\u4E32\uFF1A\u5FC5\u987B\u4EE5 "${_issue.prefix}" \u5F00\u5934`;
        if (_issue.format === "ends_with")
          return `\u65E0\u6548\u5B57\u7B26\u4E32\uFF1A\u5FC5\u987B\u4EE5 "${_issue.suffix}" \u7ED3\u5C3E`;
        if (_issue.format === "includes")
          return `\u65E0\u6548\u5B57\u7B26\u4E32\uFF1A\u5FC5\u987B\u5305\u542B "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u65E0\u6548\u5B57\u7B26\u4E32\uFF1A\u5FC5\u987B\u6EE1\u8DB3\u6B63\u5219\u8868\u8FBE\u5F0F ${_issue.pattern}`;
        return `\u65E0\u6548${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u65E0\u6548\u6570\u5B57\uFF1A\u5FC5\u987B\u662F ${issue2.divisor} \u7684\u500D\u6570`;
      case "unrecognized_keys":
        return `\u51FA\u73B0\u672A\u77E5\u7684\u952E(key): ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} \u4E2D\u7684\u952E(key)\u65E0\u6548`;
      case "invalid_union":
        return "\u65E0\u6548\u8F93\u5165";
      case "invalid_element":
        return `${issue2.origin} \u4E2D\u5305\u542B\u65E0\u6548\u503C(value)`;
      default:
        return `\u65E0\u6548\u8F93\u5165`;
    }
  };
};
function zh_CN_default() {
  return {
    localeError: error48()
  };
}

// node_modules/zod/v4/locales/zh-TW.js
var error49 = () => {
  const Sizable = {
    string: { unit: "\u5B57\u5143", verb: "\u64C1\u6709" },
    file: { unit: "\u4F4D\u5143\u7D44", verb: "\u64C1\u6709" },
    array: { unit: "\u9805\u76EE", verb: "\u64C1\u6709" },
    set: { unit: "\u9805\u76EE", verb: "\u64C1\u6709" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u8F38\u5165",
    email: "\u90F5\u4EF6\u5730\u5740",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO \u65E5\u671F\u6642\u9593",
    date: "ISO \u65E5\u671F",
    time: "ISO \u6642\u9593",
    duration: "ISO \u671F\u9593",
    ipv4: "IPv4 \u4F4D\u5740",
    ipv6: "IPv6 \u4F4D\u5740",
    cidrv4: "IPv4 \u7BC4\u570D",
    cidrv6: "IPv6 \u7BC4\u570D",
    base64: "base64 \u7DE8\u78BC\u5B57\u4E32",
    base64url: "base64url \u7DE8\u78BC\u5B57\u4E32",
    json_string: "JSON \u5B57\u4E32",
    e164: "E.164 \u6578\u503C",
    jwt: "JWT",
    template_literal: "\u8F38\u5165"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\u7121\u6548\u7684\u8F38\u5165\u503C\uFF1A\u9810\u671F\u70BA instanceof ${issue2.expected}\uFF0C\u4F46\u6536\u5230 ${received}`;
        }
        return `\u7121\u6548\u7684\u8F38\u5165\u503C\uFF1A\u9810\u671F\u70BA ${expected}\uFF0C\u4F46\u6536\u5230 ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\u7121\u6548\u7684\u8F38\u5165\u503C\uFF1A\u9810\u671F\u70BA ${stringifyPrimitive(issue2.values[0])}`;
        return `\u7121\u6548\u7684\u9078\u9805\uFF1A\u9810\u671F\u70BA\u4EE5\u4E0B\u5176\u4E2D\u4E4B\u4E00 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `\u6578\u503C\u904E\u5927\uFF1A\u9810\u671F ${issue2.origin ?? "\u503C"} \u61C9\u70BA ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "\u500B\u5143\u7D20"}`;
        return `\u6578\u503C\u904E\u5927\uFF1A\u9810\u671F ${issue2.origin ?? "\u503C"} \u61C9\u70BA ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `\u6578\u503C\u904E\u5C0F\uFF1A\u9810\u671F ${issue2.origin} \u61C9\u70BA ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `\u6578\u503C\u904E\u5C0F\uFF1A\u9810\u671F ${issue2.origin} \u61C9\u70BA ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `\u7121\u6548\u7684\u5B57\u4E32\uFF1A\u5FC5\u9808\u4EE5 "${_issue.prefix}" \u958B\u982D`;
        }
        if (_issue.format === "ends_with")
          return `\u7121\u6548\u7684\u5B57\u4E32\uFF1A\u5FC5\u9808\u4EE5 "${_issue.suffix}" \u7D50\u5C3E`;
        if (_issue.format === "includes")
          return `\u7121\u6548\u7684\u5B57\u4E32\uFF1A\u5FC5\u9808\u5305\u542B "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u7121\u6548\u7684\u5B57\u4E32\uFF1A\u5FC5\u9808\u7B26\u5408\u683C\u5F0F ${_issue.pattern}`;
        return `\u7121\u6548\u7684 ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `\u7121\u6548\u7684\u6578\u5B57\uFF1A\u5FC5\u9808\u70BA ${issue2.divisor} \u7684\u500D\u6578`;
      case "unrecognized_keys":
        return `\u7121\u6CD5\u8B58\u5225\u7684\u9375\u503C${issue2.keys.length > 1 ? "\u5011" : ""}\uFF1A${joinValues(issue2.keys, "\u3001")}`;
      case "invalid_key":
        return `${issue2.origin} \u4E2D\u6709\u7121\u6548\u7684\u9375\u503C`;
      case "invalid_union":
        return "\u7121\u6548\u7684\u8F38\u5165\u503C";
      case "invalid_element":
        return `${issue2.origin} \u4E2D\u6709\u7121\u6548\u7684\u503C`;
      default:
        return `\u7121\u6548\u7684\u8F38\u5165\u503C`;
    }
  };
};
function zh_TW_default() {
  return {
    localeError: error49()
  };
}

// node_modules/zod/v4/locales/yo.js
var error50 = () => {
  const Sizable = {
    string: { unit: "\xE0mi", verb: "n\xED" },
    file: { unit: "bytes", verb: "n\xED" },
    array: { unit: "nkan", verb: "n\xED" },
    set: { unit: "nkan", verb: "n\xED" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "\u1EB9\u0300r\u1ECD \xECb\xE1w\u1ECDl\xE9",
    email: "\xE0d\xEDr\u1EB9\u0301s\xEC \xECm\u1EB9\u0301l\xEC",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "\xE0k\xF3k\xF2 ISO",
    date: "\u1ECDj\u1ECD\u0301 ISO",
    time: "\xE0k\xF3k\xF2 ISO",
    duration: "\xE0k\xF3k\xF2 t\xF3 p\xE9 ISO",
    ipv4: "\xE0d\xEDr\u1EB9\u0301s\xEC IPv4",
    ipv6: "\xE0d\xEDr\u1EB9\u0301s\xEC IPv6",
    cidrv4: "\xE0gb\xE8gb\xE8 IPv4",
    cidrv6: "\xE0gb\xE8gb\xE8 IPv6",
    base64: "\u1ECD\u0300r\u1ECD\u0300 t\xED a k\u1ECD\u0301 n\xED base64",
    base64url: "\u1ECD\u0300r\u1ECD\u0300 base64url",
    json_string: "\u1ECD\u0300r\u1ECD\u0300 JSON",
    e164: "n\u1ECD\u0301mb\xE0 E.164",
    jwt: "JWT",
    template_literal: "\u1EB9\u0300r\u1ECD \xECb\xE1w\u1ECDl\xE9"
  };
  const TypeDictionary = {
    nan: "NaN",
    number: "n\u1ECD\u0301mb\xE0",
    array: "akop\u1ECD"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue2.expected] ?? issue2.expected;
        const receivedType = parsedType(issue2.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        if (/^[A-Z]/.test(issue2.expected)) {
          return `\xCCb\xE1w\u1ECDl\xE9 a\u1E63\xEC\u1E63e: a n\xED l\xE1ti fi instanceof ${issue2.expected}, \xE0m\u1ECD\u0300 a r\xED ${received}`;
        }
        return `\xCCb\xE1w\u1ECDl\xE9 a\u1E63\xEC\u1E63e: a n\xED l\xE1ti fi ${expected}, \xE0m\u1ECD\u0300 a r\xED ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `\xCCb\xE1w\u1ECDl\xE9 a\u1E63\xEC\u1E63e: a n\xED l\xE1ti fi ${stringifyPrimitive(issue2.values[0])}`;
        return `\xC0\u1E63\xE0y\xE0n a\u1E63\xEC\u1E63e: yan \u1ECD\u0300kan l\xE1ra ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `T\xF3 p\u1ECD\u0300 j\xF9: a n\xED l\xE1ti j\u1EB9\u0301 p\xE9 ${issue2.origin ?? "iye"} ${sizing.verb} ${adj}${issue2.maximum} ${sizing.unit}`;
        return `T\xF3 p\u1ECD\u0300 j\xF9: a n\xED l\xE1ti j\u1EB9\u0301 ${adj}${issue2.maximum}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `K\xE9r\xE9 ju: a n\xED l\xE1ti j\u1EB9\u0301 p\xE9 ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum} ${sizing.unit}`;
        return `K\xE9r\xE9 ju: a n\xED l\xE1ti j\u1EB9\u0301 ${adj}${issue2.minimum}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `\u1ECC\u0300r\u1ECD\u0300 a\u1E63\xEC\u1E63e: gb\u1ECD\u0301d\u1ECD\u0300 b\u1EB9\u0300r\u1EB9\u0300 p\u1EB9\u0300l\xFA "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `\u1ECC\u0300r\u1ECD\u0300 a\u1E63\xEC\u1E63e: gb\u1ECD\u0301d\u1ECD\u0300 par\xED p\u1EB9\u0300l\xFA "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `\u1ECC\u0300r\u1ECD\u0300 a\u1E63\xEC\u1E63e: gb\u1ECD\u0301d\u1ECD\u0300 n\xED "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `\u1ECC\u0300r\u1ECD\u0300 a\u1E63\xEC\u1E63e: gb\u1ECD\u0301d\u1ECD\u0300 b\xE1 \xE0p\u1EB9\u1EB9r\u1EB9 mu ${_issue.pattern}`;
        return `A\u1E63\xEC\u1E63e: ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `N\u1ECD\u0301mb\xE0 a\u1E63\xEC\u1E63e: gb\u1ECD\u0301d\u1ECD\u0300 j\u1EB9\u0301 \xE8y\xE0 p\xEDp\xEDn ti ${issue2.divisor}`;
      case "unrecognized_keys":
        return `B\u1ECDt\xECn\xEC \xE0\xECm\u1ECD\u0300: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `B\u1ECDt\xECn\xEC a\u1E63\xEC\u1E63e n\xEDn\xFA ${issue2.origin}`;
      case "invalid_union":
        return "\xCCb\xE1w\u1ECDl\xE9 a\u1E63\xEC\u1E63e";
      case "invalid_element":
        return `Iye a\u1E63\xEC\u1E63e n\xEDn\xFA ${issue2.origin}`;
      default:
        return "\xCCb\xE1w\u1ECDl\xE9 a\u1E63\xEC\u1E63e";
    }
  };
};
function yo_default() {
  return {
    localeError: error50()
  };
}

// node_modules/zod/v4/core/registries.js
var _a2;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta3 = _meta[0];
    this._map.set(schema, meta3);
    if (meta3 && typeof meta3 === "object" && "id" in meta3) {
      this._idmap.set(meta3.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta3 = this._map.get(schema);
    if (meta3 && typeof meta3 === "object" && "id" in meta3) {
      this._idmap.delete(meta3.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p2 = schema._zod.parent;
    if (p2) {
      const pm = { ...this.get(p2) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedString(Class2, params) {
  return new Class2({
    type: "string",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _mac(Class2, params) {
  return new Class2({
    type: "string",
    format: "mac",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
var TimePrecision = {
  Any: null,
  Minute: -1,
  Second: 0,
  Millisecond: 3,
  Microsecond: 6
};
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedNumber(Class2, params) {
  return new Class2({
    type: "number",
    coerce: true,
    checks: [],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _float32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _float64(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "int32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uint32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "uint32",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedBoolean(Class2, params) {
  return new Class2({
    type: "boolean",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _bigint(Class2, params) {
  return new Class2({
    type: "bigint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedBigint(Class2, params) {
  return new Class2({
    type: "bigint",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _int64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "int64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uint64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "uint64",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _symbol(Class2, params) {
  return new Class2({
    type: "symbol",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _undefined2(Class2, params) {
  return new Class2({
    type: "undefined",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _any(Class2) {
  return new Class2({
    type: "any"
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _void(Class2, params) {
  return new Class2({
    type: "void",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _date(Class2, params) {
  return new Class2({
    type: "date",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _coercedDate(Class2, params) {
  return new Class2({
    type: "date",
    coerce: true,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nan(Class2, params) {
  return new Class2({
    type: "nan",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _positive(params) {
  return /* @__PURE__ */ _gt(0, params);
}
// @__NO_SIDE_EFFECTS__
function _negative(params) {
  return /* @__PURE__ */ _lt(0, params);
}
// @__NO_SIDE_EFFECTS__
function _nonpositive(params) {
  return /* @__PURE__ */ _lte(0, params);
}
// @__NO_SIDE_EFFECTS__
function _nonnegative(params) {
  return /* @__PURE__ */ _gte(0, params);
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxSize(maximum, params) {
  return new $ZodCheckMaxSize({
    check: "max_size",
    ...normalizeParams(params),
    maximum
  });
}
// @__NO_SIDE_EFFECTS__
function _minSize(minimum, params) {
  return new $ZodCheckMinSize({
    check: "min_size",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _size(size, params) {
  return new $ZodCheckSizeEquals({
    check: "size_equals",
    ...normalizeParams(params),
    size
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _property(property, schema, params) {
  return new $ZodCheckProperty({
    check: "property",
    property,
    schema,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _mime(types, params) {
  return new $ZodCheckMimeType({
    check: "mime_type",
    mime: types,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _union(Class2, options, params) {
  return new Class2({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
function _xor(Class2, options, params) {
  return new Class2({
    type: "union",
    options,
    inclusive: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _discriminatedUnion(Class2, discriminator, options, params) {
  return new Class2({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _intersection(Class2, left, right) {
  return new Class2({
    type: "intersection",
    left,
    right
  });
}
// @__NO_SIDE_EFFECTS__
function _tuple(Class2, items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new Class2({
    type: "tuple",
    items,
    rest,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _record(Class2, keyType, valueType, params) {
  return new Class2({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _map(Class2, keyType, valueType, params) {
  return new Class2({
    type: "map",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _set(Class2, valueType, params) {
  return new Class2({
    type: "set",
    valueType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _enum(Class2, values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nativeEnum(Class2, entries, params) {
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _literal(Class2, value, params) {
  return new Class2({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _file(Class2, params) {
  return new Class2({
    type: "file",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _transform(Class2, fn) {
  return new Class2({
    type: "transform",
    transform: fn
  });
}
// @__NO_SIDE_EFFECTS__
function _optional(Class2, innerType) {
  return new Class2({
    type: "optional",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _nullable(Class2, innerType) {
  return new Class2({
    type: "nullable",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _default(Class2, innerType, defaultValue) {
  return new Class2({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
// @__NO_SIDE_EFFECTS__
function _nonoptional(Class2, innerType, params) {
  return new Class2({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _success(Class2, innerType) {
  return new Class2({
    type: "success",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _catch(Class2, innerType, catchValue) {
  return new Class2({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
// @__NO_SIDE_EFFECTS__
function _pipe(Class2, in_, out) {
  return new Class2({
    type: "pipe",
    in: in_,
    out
  });
}
// @__NO_SIDE_EFFECTS__
function _readonly(Class2, innerType) {
  return new Class2({
    type: "readonly",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _templateLiteral(Class2, parts, params) {
  return new Class2({
    type: "template_literal",
    parts,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lazy(Class2, getter) {
  return new Class2({
    type: "lazy",
    getter
  });
}
// @__NO_SIDE_EFFECTS__
function _promise(Class2, innerType) {
  return new Class2({
    type: "promise",
    innerType
  });
}
// @__NO_SIDE_EFFECTS__
function _custom(Class2, fn, _params) {
  const norm = normalizeParams(_params);
  norm.abort ?? (norm.abort = true);
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// @__NO_SIDE_EFFECTS__
function describe(description) {
  const ch = new $ZodCheck({ check: "describe" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, description });
    }
  ];
  ch._zod.check = () => {
  };
  return ch;
}
// @__NO_SIDE_EFFECTS__
function meta(metadata) {
  const ch = new $ZodCheck({ check: "meta" });
  ch._zod.onattach = [
    (inst) => {
      const existing = globalRegistry.get(inst) ?? {};
      globalRegistry.add(inst, { ...existing, ...metadata });
    }
  ];
  ch._zod.check = () => {
  };
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _stringbool(Classes, _params) {
  const params = normalizeParams(_params);
  let truthyArray = params.truthy ?? ["true", "1", "yes", "on", "y", "enabled"];
  let falsyArray = params.falsy ?? ["false", "0", "no", "off", "n", "disabled"];
  if (params.case !== "sensitive") {
    truthyArray = truthyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
    falsyArray = falsyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
  }
  const truthySet = new Set(truthyArray);
  const falsySet = new Set(falsyArray);
  const _Codec = Classes.Codec ?? $ZodCodec;
  const _Boolean = Classes.Boolean ?? $ZodBoolean;
  const _String = Classes.String ?? $ZodString;
  const stringSchema = new _String({ type: "string", error: params.error });
  const booleanSchema = new _Boolean({ type: "boolean", error: params.error });
  const codec2 = new _Codec({
    type: "pipe",
    in: stringSchema,
    out: booleanSchema,
    transform: ((input, payload) => {
      let data = input;
      if (params.case !== "sensitive")
        data = data.toLowerCase();
      if (truthySet.has(data)) {
        return true;
      } else if (falsySet.has(data)) {
        return false;
      } else {
        payload.issues.push({
          code: "invalid_value",
          expected: "stringbool",
          values: [...truthySet, ...falsySet],
          input: payload.value,
          inst: codec2,
          continue: false
        });
        return {};
      }
    }),
    reverseTransform: ((input, _payload) => {
      if (input === true) {
        return truthyArray[0] || "true";
      } else {
        return falsyArray[0] || "false";
      }
    }),
    error: params.error
  });
  return codec2;
}
// @__NO_SIDE_EFFECTS__
function _stringFormat(Class2, format, fnOrRegex, _params = {}) {
  const params = normalizeParams(_params);
  const def = {
    ...normalizeParams(_params),
    check: "string_format",
    type: "string",
    format,
    fn: typeof fnOrRegex === "function" ? fnOrRegex : (val) => fnOrRegex.test(val),
    ...params
  };
  if (fnOrRegex instanceof RegExp) {
    def.pattern = fnOrRegex;
  }
  const inst = new Class2(def);
  return inst;
}

// node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? void 0
  };
}
function process2(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta3 = ctx.metadataRegistry.get(schema);
  if (meta3)
    Object.assign(result.schema, meta3);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        Object.assign(schema2, refSchema);
      }
      Object.assign(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};

// node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json2 = _json;
  json2.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json2.minLength = minimum;
  if (typeof maximum === "number")
    json2.maxLength = maximum;
  if (format) {
    json2.format = formatMap[format] ?? format;
    if (json2.format === "")
      delete json2.format;
    if (format === "time") {
      delete json2.format;
    }
  }
  if (contentEncoding)
    json2.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json2.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json2.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, _params) => {
  const json2 = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json2.type = "integer";
  else
    json2.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json2.minimum = exclusiveMinimum;
      json2.exclusiveMinimum = true;
    } else {
      json2.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json2.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json2.maximum = exclusiveMaximum;
      json2.exclusiveMaximum = true;
    } else {
      json2.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json2.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json2.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json2, _params) => {
  json2.type = "boolean";
};
var bigintProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("BigInt cannot be represented in JSON Schema");
  }
};
var symbolProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Symbols cannot be represented in JSON Schema");
  }
};
var nullProcessor = (_schema, ctx, json2, _params) => {
  if (ctx.target === "openapi-3.0") {
    json2.type = "string";
    json2.nullable = true;
    json2.enum = [null];
  } else {
    json2.type = "null";
  }
};
var undefinedProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Undefined cannot be represented in JSON Schema");
  }
};
var voidProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Void cannot be represented in JSON Schema");
  }
};
var neverProcessor = (_schema, _ctx, json2, _params) => {
  json2.not = {};
};
var anyProcessor = (_schema, _ctx, _json, _params) => {
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var dateProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Date cannot be represented in JSON Schema");
  }
};
var enumProcessor = (schema, _ctx, json2, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json2.type = "number";
  if (values.every((v) => typeof v === "string"))
    json2.type = "string";
  json2.enum = values;
};
var literalProcessor = (schema, ctx, json2, _params) => {
  const def = schema._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      } else {
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {
  } else if (vals.length === 1) {
    const val = vals[0];
    json2.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json2.enum = [val];
    } else {
      json2.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json2.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json2.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json2.type = "boolean";
    if (vals.every((v) => v === null))
      json2.type = "null";
    json2.enum = vals;
  }
};
var nanProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("NaN cannot be represented in JSON Schema");
  }
};
var templateLiteralProcessor = (schema, _ctx, json2, _params) => {
  const _json = json2;
  const pattern = schema._zod.pattern;
  if (!pattern)
    throw new Error("Pattern not found in template literal");
  _json.type = "string";
  _json.pattern = pattern.source;
};
var fileProcessor = (schema, _ctx, json2, _params) => {
  const _json = json2;
  const file2 = {
    type: "string",
    format: "binary",
    contentEncoding: "binary"
  };
  const { minimum, maximum, mime } = schema._zod.bag;
  if (minimum !== void 0)
    file2.minLength = minimum;
  if (maximum !== void 0)
    file2.maxLength = maximum;
  if (mime) {
    if (mime.length === 1) {
      file2.contentMediaType = mime[0];
      Object.assign(_json, file2);
    } else {
      Object.assign(_json, file2);
      _json.anyOf = mime.map((m) => ({ contentMediaType: m }));
    }
  } else {
    Object.assign(_json, file2);
  }
};
var successProcessor = (_schema, _ctx, json2, _params) => {
  json2.type = "boolean";
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var functionProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Function types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var mapProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Map cannot be represented in JSON Schema");
  }
};
var setProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Set cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json2.minItems = minimum;
  if (typeof maximum === "number")
    json2.maxItems = maximum;
  json2.type = "array";
  json2.items = process2(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  json2.type = "object";
  json2.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json2.properties[key] = process2(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === void 0;
    } else {
      return v.optout === void 0;
    }
  }));
  if (requiredKeys.size > 0) {
    json2.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json2.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json2.additionalProperties = false;
  } else if (def.catchall) {
    json2.additionalProperties = process2(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json2.oneOf = options;
  } else {
    json2.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json2.allOf = allOf;
};
var tupleProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  json2.type = "array";
  const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
  const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
  const prefixItems = def.items.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, prefixPath, i]
  }));
  const rest = def.rest ? process2(def.rest, ctx, {
    ...params,
    path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
  }) : null;
  if (ctx.target === "draft-2020-12") {
    json2.prefixItems = prefixItems;
    if (rest) {
      json2.items = rest;
    }
  } else if (ctx.target === "openapi-3.0") {
    json2.items = {
      anyOf: prefixItems
    };
    if (rest) {
      json2.items.anyOf.push(rest);
    }
    json2.minItems = prefixItems.length;
    if (!rest) {
      json2.maxItems = prefixItems.length;
    }
  } else {
    json2.items = prefixItems;
    if (rest) {
      json2.additionalItems = rest;
    }
  }
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json2.minItems = minimum;
  if (typeof maximum === "number")
    json2.maxItems = maximum;
};
var recordProcessor = (schema, ctx, _json, params) => {
  const json2 = _json;
  const def = schema._zod.def;
  json2.type = "object";
  const keyType = def.keyType;
  const keyBag = keyType._zod.bag;
  const patterns = keyBag?.patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json2.patternProperties = {};
    for (const pattern of patterns) {
      json2.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json2.propertyNames = process2(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
    }
    json2.additionalProperties = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json2.required = validKeyValues;
    }
  }
};
var nullableProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json2.nullable = true;
  } else {
    json2.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json2.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json2._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json2.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json2, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json2.readOnly = true;
};
var promiseProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var lazyProcessor = (schema, ctx, _json, params) => {
  const innerType = schema._zod.innerType;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var allProcessors = {
  string: stringProcessor,
  number: numberProcessor,
  boolean: booleanProcessor,
  bigint: bigintProcessor,
  symbol: symbolProcessor,
  null: nullProcessor,
  undefined: undefinedProcessor,
  void: voidProcessor,
  never: neverProcessor,
  any: anyProcessor,
  unknown: unknownProcessor,
  date: dateProcessor,
  enum: enumProcessor,
  literal: literalProcessor,
  nan: nanProcessor,
  template_literal: templateLiteralProcessor,
  file: fileProcessor,
  success: successProcessor,
  custom: customProcessor,
  function: functionProcessor,
  transform: transformProcessor,
  map: mapProcessor,
  set: setProcessor,
  array: arrayProcessor,
  object: objectProcessor,
  union: unionProcessor,
  intersection: intersectionProcessor,
  tuple: tupleProcessor,
  record: recordProcessor,
  nullable: nullableProcessor,
  nonoptional: nonoptionalProcessor,
  default: defaultProcessor,
  prefault: prefaultProcessor,
  catch: catchProcessor,
  pipe: pipeProcessor,
  readonly: readonlyProcessor,
  promise: promiseProcessor,
  optional: optionalProcessor,
  lazy: lazyProcessor
};
function toJSONSchema(input, params) {
  if ("_idmap" in input) {
    const registry2 = input;
    const ctx2 = initializeContext({ ...params, processors: allProcessors });
    const defs = {};
    for (const entry of registry2._idmap.entries()) {
      const [_, schema] = entry;
      process2(schema, ctx2);
    }
    const schemas = {};
    const external = {
      registry: registry2,
      uri: params?.uri,
      defs
    };
    ctx2.external = external;
    for (const entry of registry2._idmap.entries()) {
      const [key, schema] = entry;
      extractDefs(ctx2, schema);
      schemas[key] = finalize(ctx2, schema);
    }
    if (Object.keys(defs).length > 0) {
      const defsSegment = ctx2.target === "draft-2020-12" ? "$defs" : "definitions";
      schemas.__shared = {
        [defsSegment]: defs
      };
    }
    return { schemas };
  }
  const ctx = initializeContext({ ...params, processors: allProcessors });
  process2(input, ctx);
  extractDefs(ctx, input);
  return finalize(ctx, input);
}

// node_modules/zod/v4/core/json-schema-generator.js
var JSONSchemaGenerator = class {
  /** @deprecated Access via ctx instead */
  get metadataRegistry() {
    return this.ctx.metadataRegistry;
  }
  /** @deprecated Access via ctx instead */
  get target() {
    return this.ctx.target;
  }
  /** @deprecated Access via ctx instead */
  get unrepresentable() {
    return this.ctx.unrepresentable;
  }
  /** @deprecated Access via ctx instead */
  get override() {
    return this.ctx.override;
  }
  /** @deprecated Access via ctx instead */
  get io() {
    return this.ctx.io;
  }
  /** @deprecated Access via ctx instead */
  get counter() {
    return this.ctx.counter;
  }
  set counter(value) {
    this.ctx.counter = value;
  }
  /** @deprecated Access via ctx instead */
  get seen() {
    return this.ctx.seen;
  }
  constructor(params) {
    let normalizedTarget = params?.target ?? "draft-2020-12";
    if (normalizedTarget === "draft-4")
      normalizedTarget = "draft-04";
    if (normalizedTarget === "draft-7")
      normalizedTarget = "draft-07";
    this.ctx = initializeContext({
      processors: allProcessors,
      target: normalizedTarget,
      ...params?.metadata && { metadata: params.metadata },
      ...params?.unrepresentable && { unrepresentable: params.unrepresentable },
      ...params?.override && { override: params.override },
      ...params?.io && { io: params.io }
    });
  }
  /**
   * Process a schema to prepare it for JSON Schema generation.
   * This must be called before emit().
   */
  process(schema, _params = { path: [], schemaPath: [] }) {
    return process2(schema, this.ctx, _params);
  }
  /**
   * Emit the final JSON Schema after processing.
   * Must call process() first.
   */
  emit(schema, _params) {
    if (_params) {
      if (_params.cycles)
        this.ctx.cycles = _params.cycles;
      if (_params.reused)
        this.ctx.reused = _params.reused;
      if (_params.external)
        this.ctx.external = _params.external;
    }
    extractDefs(this.ctx, schema);
    const result = finalize(this.ctx, schema);
    const { "~standard": _, ...plainResult } = result;
    return plainResult;
  }
};

// node_modules/zod/v4/core/json-schema.js
var json_schema_exports = {};

// node_modules/zod/v4/classic/schemas.js
var schemas_exports2 = {};
__export(schemas_exports2, {
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBase64: () => ZodBase64,
  ZodBase64URL: () => ZodBase64URL,
  ZodBigInt: () => ZodBigInt,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBoolean: () => ZodBoolean,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCUID: () => ZodCUID,
  ZodCUID2: () => ZodCUID2,
  ZodCatch: () => ZodCatch,
  ZodCodec: () => ZodCodec,
  ZodCustom: () => ZodCustom,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodE164: () => ZodE164,
  ZodEmail: () => ZodEmail,
  ZodEmoji: () => ZodEmoji,
  ZodEnum: () => ZodEnum,
  ZodExactOptional: () => ZodExactOptional,
  ZodFile: () => ZodFile,
  ZodFunction: () => ZodFunction,
  ZodGUID: () => ZodGUID,
  ZodIPv4: () => ZodIPv4,
  ZodIPv6: () => ZodIPv6,
  ZodIntersection: () => ZodIntersection,
  ZodJWT: () => ZodJWT,
  ZodKSUID: () => ZodKSUID,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMAC: () => ZodMAC,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNanoID: () => ZodNanoID,
  ZodNever: () => ZodNever,
  ZodNonOptional: () => ZodNonOptional,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodPipe: () => ZodPipe,
  ZodPrefault: () => ZodPrefault,
  ZodPreprocess: () => ZodPreprocess,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodStringFormat: () => ZodStringFormat,
  ZodSuccess: () => ZodSuccess,
  ZodSymbol: () => ZodSymbol,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodTransform: () => ZodTransform,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodULID: () => ZodULID,
  ZodURL: () => ZodURL,
  ZodUUID: () => ZodUUID,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  ZodXID: () => ZodXID,
  ZodXor: () => ZodXor,
  _ZodString: () => _ZodString,
  _default: () => _default2,
  _function: () => _function,
  any: () => any,
  array: () => array,
  base64: () => base642,
  base64url: () => base64url2,
  bigint: () => bigint2,
  boolean: () => boolean2,
  catch: () => _catch2,
  check: () => check,
  cidrv4: () => cidrv42,
  cidrv6: () => cidrv62,
  codec: () => codec,
  cuid: () => cuid3,
  cuid2: () => cuid22,
  custom: () => custom,
  date: () => date3,
  describe: () => describe2,
  discriminatedUnion: () => discriminatedUnion,
  e164: () => e1642,
  email: () => email2,
  emoji: () => emoji2,
  enum: () => _enum2,
  exactOptional: () => exactOptional,
  file: () => file,
  float32: () => float32,
  float64: () => float64,
  function: () => _function,
  guid: () => guid2,
  hash: () => hash,
  hex: () => hex2,
  hostname: () => hostname2,
  httpUrl: () => httpUrl,
  instanceof: () => _instanceof,
  int: () => int,
  int32: () => int32,
  int64: () => int64,
  intersection: () => intersection,
  invertCodec: () => invertCodec,
  ipv4: () => ipv42,
  ipv6: () => ipv62,
  json: () => json,
  jwt: () => jwt,
  keyof: () => keyof,
  ksuid: () => ksuid2,
  lazy: () => lazy,
  literal: () => literal,
  looseObject: () => looseObject,
  looseRecord: () => looseRecord,
  mac: () => mac2,
  map: () => map,
  meta: () => meta2,
  nan: () => nan,
  nanoid: () => nanoid2,
  nativeEnum: () => nativeEnum,
  never: () => never,
  nonoptional: () => nonoptional,
  null: () => _null3,
  nullable: () => nullable,
  nullish: () => nullish2,
  number: () => number2,
  object: () => object,
  optional: () => optional,
  partialRecord: () => partialRecord,
  pipe: () => pipe,
  prefault: () => prefault,
  preprocess: () => preprocess,
  promise: () => promise,
  readonly: () => readonly,
  record: () => record,
  refine: () => refine,
  set: () => set,
  strictObject: () => strictObject,
  string: () => string2,
  stringFormat: () => stringFormat,
  stringbool: () => stringbool,
  success: () => success,
  superRefine: () => superRefine,
  symbol: () => symbol,
  templateLiteral: () => templateLiteral,
  transform: () => transform,
  tuple: () => tuple,
  uint32: () => uint32,
  uint64: () => uint64,
  ulid: () => ulid2,
  undefined: () => _undefined3,
  union: () => union,
  unknown: () => unknown,
  url: () => url,
  uuid: () => uuid2,
  uuidv4: () => uuidv4,
  uuidv6: () => uuidv6,
  uuidv7: () => uuidv7,
  void: () => _void2,
  xid: () => xid2,
  xor: () => xor
});

// node_modules/zod/v4/classic/checks.js
var checks_exports2 = {};
__export(checks_exports2, {
  endsWith: () => _endsWith,
  gt: () => _gt,
  gte: () => _gte,
  includes: () => _includes,
  length: () => _length,
  lowercase: () => _lowercase,
  lt: () => _lt,
  lte: () => _lte,
  maxLength: () => _maxLength,
  maxSize: () => _maxSize,
  mime: () => _mime,
  minLength: () => _minLength,
  minSize: () => _minSize,
  multipleOf: () => _multipleOf,
  negative: () => _negative,
  nonnegative: () => _nonnegative,
  nonpositive: () => _nonpositive,
  normalize: () => _normalize,
  overwrite: () => _overwrite,
  positive: () => _positive,
  property: () => _property,
  regex: () => _regex,
  size: () => _size,
  slugify: () => _slugify,
  startsWith: () => _startsWith,
  toLowerCase: () => _toLowerCase,
  toUpperCase: () => _toUpperCase,
  trim: () => _trim,
  uppercase: () => _uppercase
});

// node_modules/zod/v4/classic/iso.js
var iso_exports = {};
__export(iso_exports, {
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  date: () => date2,
  datetime: () => datetime2,
  duration: () => duration2,
  time: () => time2
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
      // enumerable: false,
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
      // enumerable: false,
    },
    addIssue: {
      value: (issue2) => {
        inst.issues.push(issue2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    addIssues: {
      value: (issues2) => {
        inst.issues.push(...issues2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
      // enumerable: false,
    }
  });
};
var ZodError = /* @__PURE__ */ $constructor("ZodError", initializer2);
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode2 = /* @__PURE__ */ _encode(ZodRealError);
var decode2 = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync2 = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync2 = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode2 = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode2 = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync2 = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync2 = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = /* @__PURE__ */ new Set();
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse2(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode2(inst, data, params);
  inst.decode = (data, params) => decode2(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync2(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync2(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode2(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode2(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync2(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync2(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def2 = this.def;
      return this.clone(util_exports.mergeDefs(def2, {
        checks: [
          ...def2.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def2, params) {
      return clone(this, def2, params);
    },
    brand() {
      return this;
    },
    register(reg, meta3) {
      reg.add(this, meta3);
      return this;
    },
    refine(check2, params) {
      return this.check(refine(check2, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(_overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default2(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch2(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(void 0).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => stringProcessor(inst, ctx, json2, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  });
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function email2(params) {
  return _email(ZodEmail, params);
}
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function guid2(params) {
  return _guid(ZodGUID, params);
}
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function uuid2(params) {
  return _uuid(ZodUUID, params);
}
function uuidv4(params) {
  return _uuidv4(ZodUUID, params);
}
function uuidv6(params) {
  return _uuidv6(ZodUUID, params);
}
function uuidv7(params) {
  return _uuidv7(ZodUUID, params);
}
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return _url(ZodURL, params);
}
function httpUrl(params) {
  return _url(ZodURL, {
    protocol: regexes_exports.httpProtocol,
    hostname: regexes_exports.domain,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function emoji2(params) {
  return _emoji2(ZodEmoji, params);
}
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function nanoid2(params) {
  return _nanoid(ZodNanoID, params);
}
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid3(params) {
  return _cuid(ZodCUID, params);
}
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid22(params) {
  return _cuid2(ZodCUID2, params);
}
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ulid2(params) {
  return _ulid(ZodULID, params);
}
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function xid2(params) {
  return _xid(ZodXID, params);
}
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ksuid2(params) {
  return _ksuid(ZodKSUID, params);
}
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv42(params) {
  return _ipv4(ZodIPv4, params);
}
var ZodMAC = /* @__PURE__ */ $constructor("ZodMAC", (inst, def) => {
  $ZodMAC.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function mac2(params) {
  return _mac(ZodMAC, params);
}
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv62(params) {
  return _ipv6(ZodIPv6, params);
}
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv42(params) {
  return _cidrv4(ZodCIDRv4, params);
}
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv62(params) {
  return _cidrv6(ZodCIDRv6, params);
}
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base642(params) {
  return _base64(ZodBase64, params);
}
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base64url2(params) {
  return _base64url(ZodBase64URL, params);
}
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function e1642(params) {
  return _e164(ZodE164, params);
}
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function jwt(params) {
  return _jwt(ZodJWT, params);
}
var ZodCustomStringFormat = /* @__PURE__ */ $constructor("ZodCustomStringFormat", (inst, def) => {
  $ZodCustomStringFormat.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function stringFormat(format, fnOrRegex, _params = {}) {
  return _stringFormat(ZodCustomStringFormat, format, fnOrRegex, _params);
}
function hostname2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hostname", regexes_exports.hostname, _params);
}
function hex2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hex", regexes_exports.hex, _params);
}
function hash(alg, params) {
  const enc = params?.enc ?? "hex";
  const format = `${alg}_${enc}`;
  const regex = regexes_exports[format];
  if (!regex)
    throw new Error(`Unrecognized hash format: ${format}`);
  return _stringFormat(ZodCustomStringFormat, format, regex, params);
}
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => numberProcessor(inst, ctx, json2, params);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
function float32(params) {
  return _float32(ZodNumberFormat, params);
}
function float64(params) {
  return _float64(ZodNumberFormat, params);
}
function int32(params) {
  return _int32(ZodNumberFormat, params);
}
function uint32(params) {
  return _uint32(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => booleanProcessor(inst, ctx, json2, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodBigInt = /* @__PURE__ */ $constructor("ZodBigInt", (inst, def) => {
  $ZodBigInt.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => bigintProcessor(inst, ctx, json2, params);
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.positive = (params) => inst.check(_gt(BigInt(0), params));
  inst.negative = (params) => inst.check(_lt(BigInt(0), params));
  inst.nonpositive = (params) => inst.check(_lte(BigInt(0), params));
  inst.nonnegative = (params) => inst.check(_gte(BigInt(0), params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  const bag = inst._zod.bag;
  inst.minValue = bag.minimum ?? null;
  inst.maxValue = bag.maximum ?? null;
  inst.format = bag.format ?? null;
});
function bigint2(params) {
  return _bigint(ZodBigInt, params);
}
var ZodBigIntFormat = /* @__PURE__ */ $constructor("ZodBigIntFormat", (inst, def) => {
  $ZodBigIntFormat.init(inst, def);
  ZodBigInt.init(inst, def);
});
function int64(params) {
  return _int64(ZodBigIntFormat, params);
}
function uint64(params) {
  return _uint64(ZodBigIntFormat, params);
}
var ZodSymbol = /* @__PURE__ */ $constructor("ZodSymbol", (inst, def) => {
  $ZodSymbol.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => symbolProcessor(inst, ctx, json2, params);
});
function symbol(params) {
  return _symbol(ZodSymbol, params);
}
var ZodUndefined = /* @__PURE__ */ $constructor("ZodUndefined", (inst, def) => {
  $ZodUndefined.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => undefinedProcessor(inst, ctx, json2, params);
});
function _undefined3(params) {
  return _undefined2(ZodUndefined, params);
}
var ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nullProcessor(inst, ctx, json2, params);
});
function _null3(params) {
  return _null2(ZodNull, params);
}
var ZodAny = /* @__PURE__ */ $constructor("ZodAny", (inst, def) => {
  $ZodAny.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => anyProcessor(inst, ctx, json2, params);
});
function any() {
  return _any(ZodAny);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unknownProcessor(inst, ctx, json2, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => neverProcessor(inst, ctx, json2, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodVoid = /* @__PURE__ */ $constructor("ZodVoid", (inst, def) => {
  $ZodVoid.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => voidProcessor(inst, ctx, json2, params);
});
function _void2(params) {
  return _void(ZodVoid, params);
}
var ZodDate = /* @__PURE__ */ $constructor("ZodDate", (inst, def) => {
  $ZodDate.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => dateProcessor(inst, ctx, json2, params);
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  const c = inst._zod.bag;
  inst.minDate = c.minimum ? new Date(c.minimum) : null;
  inst.maxDate = c.maximum ? new Date(c.maximum) : null;
});
function date3(params) {
  return _date(ZodDate, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => arrayProcessor(inst, ctx, json2, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(_minLength(n, params));
    },
    nonempty(params) {
      return this.check(_minLength(1, params));
    },
    max(n, params) {
      return this.check(_maxLength(n, params));
    },
    length(n, params) {
      return this.check(_length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
function keyof(schema) {
  const shape = schema._zod.def.shape;
  return _enum2(Object.keys(shape));
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => objectProcessor(inst, ctx, json2, params);
  util_exports.defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum2(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: void 0 });
    },
    extend(incoming) {
      return util_exports.extend(this, incoming);
    },
    safeExtend(incoming) {
      return util_exports.safeExtend(this, incoming);
    },
    merge(other) {
      return util_exports.merge(this, other);
    },
    pick(mask) {
      return util_exports.pick(this, mask);
    },
    omit(mask) {
      return util_exports.omit(this, mask);
    },
    partial(...args) {
      return util_exports.partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return util_exports.required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...util_exports.normalizeParams(params)
  });
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...util_exports.normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
var ZodXor = /* @__PURE__ */ $constructor("ZodXor", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodXor.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => unionProcessor(inst, ctx, json2, params);
  inst.options = def.options;
});
function xor(options, params) {
  return new ZodXor({
    type: "union",
    options,
    inclusive: false,
    ...util_exports.normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => intersectionProcessor(inst, ctx, json2, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodTuple = /* @__PURE__ */ $constructor("ZodTuple", (inst, def) => {
  $ZodTuple.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => tupleProcessor(inst, ctx, json2, params);
  inst.rest = (rest) => inst.clone({
    ...inst._zod.def,
    rest
  });
});
function tuple(items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodTuple({
    type: "tuple",
    items,
    rest,
    ...util_exports.normalizeParams(params)
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => recordProcessor(inst, ctx, json2, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...util_exports.normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function partialRecord(keyType, valueType, params) {
  const k = clone(keyType);
  k._zod.values = void 0;
  return new ZodRecord({
    type: "record",
    keyType: k,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
function looseRecord(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    mode: "loose",
    ...util_exports.normalizeParams(params)
  });
}
var ZodMap = /* @__PURE__ */ $constructor("ZodMap", (inst, def) => {
  $ZodMap.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => mapProcessor(inst, ctx, json2, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
  inst.min = (...args) => inst.check(_minSize(...args));
  inst.nonempty = (params) => inst.check(_minSize(1, params));
  inst.max = (...args) => inst.check(_maxSize(...args));
  inst.size = (...args) => inst.check(_size(...args));
});
function map(keyType, valueType, params) {
  return new ZodMap({
    type: "map",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodSet = /* @__PURE__ */ $constructor("ZodSet", (inst, def) => {
  $ZodSet.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => setProcessor(inst, ctx, json2, params);
  inst.min = (...args) => inst.check(_minSize(...args));
  inst.nonempty = (params) => inst.check(_minSize(1, params));
  inst.max = (...args) => inst.check(_maxSize(...args));
  inst.size = (...args) => inst.check(_size(...args));
});
function set(valueType, params) {
  return new ZodSet({
    type: "set",
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => enumProcessor(inst, ctx, json2, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum2(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
function nativeEnum(entries, params) {
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => literalProcessor(inst, ctx, json2, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...util_exports.normalizeParams(params)
  });
}
var ZodFile = /* @__PURE__ */ $constructor("ZodFile", (inst, def) => {
  $ZodFile.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => fileProcessor(inst, ctx, json2, params);
  inst.min = (size, params) => inst.check(_minSize(size, params));
  inst.max = (size, params) => inst.check(_maxSize(size, params));
  inst.mime = (types, params) => inst.check(_mime(Array.isArray(types) ? types : [types], params));
});
function file(params) {
  return _file(ZodFile, params);
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => transformProcessor(inst, ctx, json2, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => optionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nullableProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
function nullish2(innerType) {
  return optional(nullable(innerType));
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => defaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default2(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => prefaultProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nonoptionalProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodSuccess = /* @__PURE__ */ $constructor("ZodSuccess", (inst, def) => {
  $ZodSuccess.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => successProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function success(innerType) {
  return new ZodSuccess({
    type: "success",
    innerType
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => catchProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch2(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodNaN = /* @__PURE__ */ $constructor("ZodNaN", (inst, def) => {
  $ZodNaN.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => nanProcessor(inst, ctx, json2, params);
});
function nan(params) {
  return _nan(ZodNaN, params);
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => pipeProcessor(inst, ctx, json2, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodCodec = /* @__PURE__ */ $constructor("ZodCodec", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodCodec.init(inst, def);
});
function codec(in_, out, params) {
  return new ZodCodec({
    type: "pipe",
    in: in_,
    out,
    transform: params.decode,
    reverseTransform: params.encode
  });
}
function invertCodec(codec2) {
  const def = codec2._zod.def;
  return new ZodCodec({
    type: "pipe",
    in: def.out,
    out: def.in,
    transform: def.reverseTransform,
    reverseTransform: def.transform
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => readonlyProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodTemplateLiteral = /* @__PURE__ */ $constructor("ZodTemplateLiteral", (inst, def) => {
  $ZodTemplateLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => templateLiteralProcessor(inst, ctx, json2, params);
});
function templateLiteral(parts, params) {
  return new ZodTemplateLiteral({
    type: "template_literal",
    parts,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLazy = /* @__PURE__ */ $constructor("ZodLazy", (inst, def) => {
  $ZodLazy.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => lazyProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.getter();
});
function lazy(getter) {
  return new ZodLazy({
    type: "lazy",
    getter
  });
}
var ZodPromise = /* @__PURE__ */ $constructor("ZodPromise", (inst, def) => {
  $ZodPromise.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => promiseProcessor(inst, ctx, json2, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function promise(innerType) {
  return new ZodPromise({
    type: "promise",
    innerType
  });
}
var ZodFunction = /* @__PURE__ */ $constructor("ZodFunction", (inst, def) => {
  $ZodFunction.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => functionProcessor(inst, ctx, json2, params);
});
function _function(params) {
  return new ZodFunction({
    type: "function",
    input: Array.isArray(params?.input) ? tuple(params?.input) : params?.input ?? array(unknown()),
    output: params?.output ?? unknown()
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json2, params) => customProcessor(inst, ctx, json2, params);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
    // ...util.normalizeParams(params),
  });
  ch._zod.check = fn;
  return ch;
}
function custom(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => true), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
var describe2 = describe;
var meta2 = meta;
function _instanceof(cls, params = {}) {
  const inst = new ZodCustom({
    type: "custom",
    check: "custom",
    fn: (data) => data instanceof cls,
    abort: true,
    ...util_exports.normalizeParams(params)
  });
  inst._zod.bag.Class = cls;
  inst._zod.check = (payload) => {
    if (!(payload.value instanceof cls)) {
      payload.issues.push({
        code: "invalid_type",
        expected: cls.name,
        input: payload.value,
        inst,
        path: [...inst._zod.def.path ?? []]
      });
    }
  };
  return inst;
}
var stringbool = (...args) => _stringbool({
  Codec: ZodCodec,
  Boolean: ZodBoolean,
  String: ZodString
}, ...args);
function json(params) {
  const jsonSchema = lazy(() => {
    return union([string2(params), number2(), boolean2(), _null3(), array(jsonSchema), record(string2(), jsonSchema)]);
  });
  return jsonSchema;
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}

// node_modules/zod/v4/classic/compat.js
var ZodIssueCode = {
  invalid_type: "invalid_type",
  too_big: "too_big",
  too_small: "too_small",
  invalid_format: "invalid_format",
  not_multiple_of: "not_multiple_of",
  unrecognized_keys: "unrecognized_keys",
  invalid_union: "invalid_union",
  invalid_key: "invalid_key",
  invalid_element: "invalid_element",
  invalid_value: "invalid_value",
  custom: "custom"
};
function setErrorMap(map2) {
  config({
    customError: map2
  });
}
function getErrorMap() {
  return config().customError;
}
var ZodFirstPartyTypeKind;
/* @__PURE__ */ (function(ZodFirstPartyTypeKind2) {
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));

// node_modules/zod/v4/classic/from-json-schema.js
var z = {
  ...schemas_exports2,
  ...checks_exports2,
  iso: iso_exports
};
var RECOGNIZED_KEYS = /* @__PURE__ */ new Set([
  // Schema identification
  "$schema",
  "$ref",
  "$defs",
  "definitions",
  // Core schema keywords
  "$id",
  "id",
  "$comment",
  "$anchor",
  "$vocabulary",
  "$dynamicRef",
  "$dynamicAnchor",
  // Type
  "type",
  "enum",
  "const",
  // Composition
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  // Object
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  // Array
  "items",
  "prefixItems",
  "additionalItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  // String
  "minLength",
  "maxLength",
  "pattern",
  "format",
  // Number
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  // Already handled metadata
  "description",
  "default",
  // Content
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  // Unsupported (error-throwing)
  "unevaluatedItems",
  "unevaluatedProperties",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "dependentRequired",
  // OpenAPI
  "nullable",
  "readOnly"
]);
function detectVersion(schema, defaultTarget) {
  const $schema = schema.$schema;
  if ($schema === "https://json-schema.org/draft/2020-12/schema") {
    return "draft-2020-12";
  }
  if ($schema === "http://json-schema.org/draft-07/schema#") {
    return "draft-7";
  }
  if ($schema === "http://json-schema.org/draft-04/schema#") {
    return "draft-4";
  }
  return defaultTarget ?? "draft-2020-12";
}
function resolveRef(ref, ctx) {
  if (!ref.startsWith("#")) {
    throw new Error("External $ref is not supported, only local refs (#/...) are allowed");
  }
  const path = ref.slice(1).split("/").filter(Boolean);
  if (path.length === 0) {
    return ctx.rootSchema;
  }
  const defsKey = ctx.version === "draft-2020-12" ? "$defs" : "definitions";
  if (path[0] === defsKey) {
    const key = path[1];
    if (!key || !ctx.defs[key]) {
      throw new Error(`Reference not found: ${ref}`);
    }
    return ctx.defs[key];
  }
  throw new Error(`Reference not found: ${ref}`);
}
function convertBaseSchema(schema, ctx) {
  if (schema.not !== void 0) {
    if (typeof schema.not === "object" && Object.keys(schema.not).length === 0) {
      return z.never();
    }
    throw new Error("not is not supported in Zod (except { not: {} } for never)");
  }
  if (schema.unevaluatedItems !== void 0) {
    throw new Error("unevaluatedItems is not supported");
  }
  if (schema.unevaluatedProperties !== void 0) {
    throw new Error("unevaluatedProperties is not supported");
  }
  if (schema.if !== void 0 || schema.then !== void 0 || schema.else !== void 0) {
    throw new Error("Conditional schemas (if/then/else) are not supported");
  }
  if (schema.dependentSchemas !== void 0 || schema.dependentRequired !== void 0) {
    throw new Error("dependentSchemas and dependentRequired are not supported");
  }
  if (schema.$ref) {
    const refPath = schema.$ref;
    if (ctx.refs.has(refPath)) {
      return ctx.refs.get(refPath);
    }
    if (ctx.processing.has(refPath)) {
      return z.lazy(() => {
        if (!ctx.refs.has(refPath)) {
          throw new Error(`Circular reference not resolved: ${refPath}`);
        }
        return ctx.refs.get(refPath);
      });
    }
    ctx.processing.add(refPath);
    const resolved = resolveRef(refPath, ctx);
    const zodSchema2 = convertSchema(resolved, ctx);
    ctx.refs.set(refPath, zodSchema2);
    ctx.processing.delete(refPath);
    return zodSchema2;
  }
  if (schema.enum !== void 0) {
    const enumValues = schema.enum;
    if (ctx.version === "openapi-3.0" && schema.nullable === true && enumValues.length === 1 && enumValues[0] === null) {
      return z.null();
    }
    if (enumValues.length === 0) {
      return z.never();
    }
    if (enumValues.length === 1) {
      return z.literal(enumValues[0]);
    }
    if (enumValues.every((v) => typeof v === "string")) {
      return z.enum(enumValues);
    }
    const literalSchemas = enumValues.map((v) => z.literal(v));
    if (literalSchemas.length < 2) {
      return literalSchemas[0];
    }
    return z.union([literalSchemas[0], literalSchemas[1], ...literalSchemas.slice(2)]);
  }
  if (schema.const !== void 0) {
    return z.literal(schema.const);
  }
  const type = schema.type;
  if (Array.isArray(type)) {
    const typeSchemas = type.map((t) => {
      const typeSchema = { ...schema, type: t };
      return convertBaseSchema(typeSchema, ctx);
    });
    if (typeSchemas.length === 0) {
      return z.never();
    }
    if (typeSchemas.length === 1) {
      return typeSchemas[0];
    }
    return z.union(typeSchemas);
  }
  if (!type) {
    return z.any();
  }
  let zodSchema;
  switch (type) {
    case "string": {
      let stringSchema = z.string();
      if (schema.format) {
        const format = schema.format;
        if (format === "email") {
          stringSchema = stringSchema.check(z.email());
        } else if (format === "uri" || format === "uri-reference") {
          stringSchema = stringSchema.check(z.url());
        } else if (format === "uuid" || format === "guid") {
          stringSchema = stringSchema.check(z.uuid());
        } else if (format === "date-time") {
          stringSchema = stringSchema.check(z.iso.datetime());
        } else if (format === "date") {
          stringSchema = stringSchema.check(z.iso.date());
        } else if (format === "time") {
          stringSchema = stringSchema.check(z.iso.time());
        } else if (format === "duration") {
          stringSchema = stringSchema.check(z.iso.duration());
        } else if (format === "ipv4") {
          stringSchema = stringSchema.check(z.ipv4());
        } else if (format === "ipv6") {
          stringSchema = stringSchema.check(z.ipv6());
        } else if (format === "mac") {
          stringSchema = stringSchema.check(z.mac());
        } else if (format === "cidr") {
          stringSchema = stringSchema.check(z.cidrv4());
        } else if (format === "cidr-v6") {
          stringSchema = stringSchema.check(z.cidrv6());
        } else if (format === "base64") {
          stringSchema = stringSchema.check(z.base64());
        } else if (format === "base64url") {
          stringSchema = stringSchema.check(z.base64url());
        } else if (format === "e164") {
          stringSchema = stringSchema.check(z.e164());
        } else if (format === "jwt") {
          stringSchema = stringSchema.check(z.jwt());
        } else if (format === "emoji") {
          stringSchema = stringSchema.check(z.emoji());
        } else if (format === "nanoid") {
          stringSchema = stringSchema.check(z.nanoid());
        } else if (format === "cuid") {
          stringSchema = stringSchema.check(z.cuid());
        } else if (format === "cuid2") {
          stringSchema = stringSchema.check(z.cuid2());
        } else if (format === "ulid") {
          stringSchema = stringSchema.check(z.ulid());
        } else if (format === "xid") {
          stringSchema = stringSchema.check(z.xid());
        } else if (format === "ksuid") {
          stringSchema = stringSchema.check(z.ksuid());
        }
      }
      if (typeof schema.minLength === "number") {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (typeof schema.maxLength === "number") {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      if (schema.pattern) {
        stringSchema = stringSchema.regex(new RegExp(schema.pattern));
      }
      zodSchema = stringSchema;
      break;
    }
    case "number":
    case "integer": {
      let numberSchema = type === "integer" ? z.number().int() : z.number();
      if (typeof schema.minimum === "number") {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === "number") {
        numberSchema = numberSchema.max(schema.maximum);
      }
      if (typeof schema.exclusiveMinimum === "number") {
        numberSchema = numberSchema.gt(schema.exclusiveMinimum);
      } else if (schema.exclusiveMinimum === true && typeof schema.minimum === "number") {
        numberSchema = numberSchema.gt(schema.minimum);
      }
      if (typeof schema.exclusiveMaximum === "number") {
        numberSchema = numberSchema.lt(schema.exclusiveMaximum);
      } else if (schema.exclusiveMaximum === true && typeof schema.maximum === "number") {
        numberSchema = numberSchema.lt(schema.maximum);
      }
      if (typeof schema.multipleOf === "number") {
        numberSchema = numberSchema.multipleOf(schema.multipleOf);
      }
      zodSchema = numberSchema;
      break;
    }
    case "boolean": {
      zodSchema = z.boolean();
      break;
    }
    case "null": {
      zodSchema = z.null();
      break;
    }
    case "object": {
      const shape = {};
      const properties = schema.properties || {};
      const requiredSet = new Set(schema.required || []);
      for (const [key, propSchema] of Object.entries(properties)) {
        const propZodSchema = convertSchema(propSchema, ctx);
        shape[key] = requiredSet.has(key) ? propZodSchema : propZodSchema.optional();
      }
      if (schema.propertyNames) {
        const keySchema = convertSchema(schema.propertyNames, ctx);
        const valueSchema = schema.additionalProperties && typeof schema.additionalProperties === "object" ? convertSchema(schema.additionalProperties, ctx) : z.any();
        if (Object.keys(shape).length === 0) {
          zodSchema = z.record(keySchema, valueSchema);
          break;
        }
        const objectSchema2 = z.object(shape).passthrough();
        const recordSchema = z.looseRecord(keySchema, valueSchema);
        zodSchema = z.intersection(objectSchema2, recordSchema);
        break;
      }
      if (schema.patternProperties) {
        const patternProps = schema.patternProperties;
        const patternKeys = Object.keys(patternProps);
        const looseRecords = [];
        for (const pattern of patternKeys) {
          const patternValue = convertSchema(patternProps[pattern], ctx);
          const keySchema = z.string().regex(new RegExp(pattern));
          looseRecords.push(z.looseRecord(keySchema, patternValue));
        }
        const schemasToIntersect = [];
        if (Object.keys(shape).length > 0) {
          schemasToIntersect.push(z.object(shape).passthrough());
        }
        schemasToIntersect.push(...looseRecords);
        if (schemasToIntersect.length === 0) {
          zodSchema = z.object({}).passthrough();
        } else if (schemasToIntersect.length === 1) {
          zodSchema = schemasToIntersect[0];
        } else {
          let result = z.intersection(schemasToIntersect[0], schemasToIntersect[1]);
          for (let i = 2; i < schemasToIntersect.length; i++) {
            result = z.intersection(result, schemasToIntersect[i]);
          }
          zodSchema = result;
        }
        break;
      }
      const objectSchema = z.object(shape);
      if (schema.additionalProperties === false) {
        zodSchema = objectSchema.strict();
      } else if (typeof schema.additionalProperties === "object") {
        zodSchema = objectSchema.catchall(convertSchema(schema.additionalProperties, ctx));
      } else {
        zodSchema = objectSchema.passthrough();
      }
      break;
    }
    case "array": {
      const prefixItems = schema.prefixItems;
      const items = schema.items;
      if (prefixItems && Array.isArray(prefixItems)) {
        const tupleItems = prefixItems.map((item) => convertSchema(item, ctx));
        const rest = items && typeof items === "object" && !Array.isArray(items) ? convertSchema(items, ctx) : void 0;
        if (rest) {
          zodSchema = z.tuple(tupleItems).rest(rest);
        } else {
          zodSchema = z.tuple(tupleItems);
        }
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (Array.isArray(items)) {
        const tupleItems = items.map((item) => convertSchema(item, ctx));
        const rest = schema.additionalItems && typeof schema.additionalItems === "object" ? convertSchema(schema.additionalItems, ctx) : void 0;
        if (rest) {
          zodSchema = z.tuple(tupleItems).rest(rest);
        } else {
          zodSchema = z.tuple(tupleItems);
        }
        if (typeof schema.minItems === "number") {
          zodSchema = zodSchema.check(z.minLength(schema.minItems));
        }
        if (typeof schema.maxItems === "number") {
          zodSchema = zodSchema.check(z.maxLength(schema.maxItems));
        }
      } else if (items !== void 0) {
        const element = convertSchema(items, ctx);
        let arraySchema = z.array(element);
        if (typeof schema.minItems === "number") {
          arraySchema = arraySchema.min(schema.minItems);
        }
        if (typeof schema.maxItems === "number") {
          arraySchema = arraySchema.max(schema.maxItems);
        }
        zodSchema = arraySchema;
      } else {
        zodSchema = z.array(z.any());
      }
      break;
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
  return zodSchema;
}
function convertSchema(schema, ctx) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let baseSchema = convertBaseSchema(schema, ctx);
  const hasExplicitType = schema.type || schema.enum !== void 0 || schema.const !== void 0;
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.map((s) => convertSchema(s, ctx));
    const anyOfUnion = z.union(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, anyOfUnion) : anyOfUnion;
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const options = schema.oneOf.map((s) => convertSchema(s, ctx));
    const oneOfUnion = z.xor(options);
    baseSchema = hasExplicitType ? z.intersection(baseSchema, oneOfUnion) : oneOfUnion;
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    if (schema.allOf.length === 0) {
      baseSchema = hasExplicitType ? baseSchema : z.any();
    } else {
      let result = hasExplicitType ? baseSchema : convertSchema(schema.allOf[0], ctx);
      const startIdx = hasExplicitType ? 0 : 1;
      for (let i = startIdx; i < schema.allOf.length; i++) {
        result = z.intersection(result, convertSchema(schema.allOf[i], ctx));
      }
      baseSchema = result;
    }
  }
  if (schema.nullable === true && ctx.version === "openapi-3.0") {
    baseSchema = z.nullable(baseSchema);
  }
  if (schema.readOnly === true) {
    baseSchema = z.readonly(baseSchema);
  }
  if (schema.default !== void 0) {
    baseSchema = baseSchema.default(schema.default);
  }
  const extraMeta = {};
  const coreMetadataKeys = ["$id", "id", "$comment", "$anchor", "$vocabulary", "$dynamicRef", "$dynamicAnchor"];
  for (const key of coreMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  const contentMetadataKeys = ["contentEncoding", "contentMediaType", "contentSchema"];
  for (const key of contentMetadataKeys) {
    if (key in schema) {
      extraMeta[key] = schema[key];
    }
  }
  for (const key of Object.keys(schema)) {
    if (!RECOGNIZED_KEYS.has(key)) {
      extraMeta[key] = schema[key];
    }
  }
  if (Object.keys(extraMeta).length > 0) {
    ctx.registry.add(baseSchema, extraMeta);
  }
  if (schema.description) {
    baseSchema = baseSchema.describe(schema.description);
  }
  return baseSchema;
}
function fromJSONSchema(schema, params) {
  if (typeof schema === "boolean") {
    return schema ? z.any() : z.never();
  }
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify(schema));
  } catch {
    throw new Error("fromJSONSchema input is not valid JSON (possibly cyclic); use $defs/$ref for recursive schemas");
  }
  const version2 = detectVersion(normalized, params?.defaultTarget);
  const defs = normalized.$defs || normalized.definitions || {};
  const ctx = {
    version: version2,
    defs,
    refs: /* @__PURE__ */ new Map(),
    processing: /* @__PURE__ */ new Set(),
    rootSchema: normalized,
    registry: params?.registry ?? globalRegistry
  };
  return convertSchema(normalized, ctx);
}

// node_modules/zod/v4/classic/coerce.js
var coerce_exports = {};
__export(coerce_exports, {
  bigint: () => bigint3,
  boolean: () => boolean3,
  date: () => date4,
  number: () => number3,
  string: () => string3
});
function string3(params) {
  return _coercedString(ZodString, params);
}
function number3(params) {
  return _coercedNumber(ZodNumber, params);
}
function boolean3(params) {
  return _coercedBoolean(ZodBoolean, params);
}
function bigint3(params) {
  return _coercedBigint(ZodBigInt, params);
}
function date4(params) {
  return _coercedDate(ZodDate, params);
}

// node_modules/zod/v4/classic/external.js
config(en_default());

// brain/confidence/types.ts
var CONFIDENCE_LEVELS = [
  "VERIFIED",
  "PROBABLE",
  "INFERRED",
  "SPECULATIVE"
];
function emptyConfidenceDistribution() {
  return {
    VERIFIED: 0,
    PROBABLE: 0,
    INFERRED: 0,
    SPECULATIVE: 0
  };
}

// brain/evidence-finding/compute-confidence.ts
function computeConfidenceScore(input) {
  const baseByMethod = {
    STATIC_ANALYSIS: 0.62,
    DYNAMIC_ANALYSIS: 0.78,
    REPLAY: 0.9,
    MOCK_SIMULATION: 0.68,
    AUTHORIZED_STAGING: 0.88,
    LIVE_VERIFICATION: 0.94,
    HYBRID: 0.82
  };
  let score = baseByMethod[input.detectionMethod];
  const reasons = [`Base confidence for ${input.detectionMethod.replaceAll("_", " ").toLowerCase()}.`];
  const weightedEvidence = input.evidenceItems.reduce((sum, item) => {
    return sum + (item.confidence ?? 0.5);
  }, 0);
  if (input.evidenceItems.length > 0) {
    const evidenceBoost = Math.min(0.2, weightedEvidence / input.evidenceItems.length / 5);
    score += evidenceBoost;
    reasons.push(`${input.evidenceItems.length} evidence item(s) support the finding.`);
  }
  if (input.hasRuntimeEvidence) {
    score += 0.08;
    reasons.push("Runtime request/response evidence was captured.");
  }
  if (input.hasReplayEvidence) {
    score += 0.1;
    reasons.push("Replay reproduced the behavior.");
  }
  if ((input.signalHits ?? 0) >= 2) {
    score += 0.05;
    reasons.push("Multiple independent exploit signals matched.");
  }
  if (input.severity === "critical") {
    score += 0.03;
    reasons.push("Critical severity pattern increases confidence.");
  }
  score = Math.min(0.99, Math.max(0.05, Number(score.toFixed(3))));
  return {
    confidence: score,
    explanation: reasons.join(" ")
  };
}
function confidencePercent(confidence) {
  return Math.round(confidence * 100);
}

// brain/confidence/invariants.ts
var ALLOWED_BY_VERIFICATION = {
  CONFIRMED: ["VERIFIED"],
  POTENTIAL: ["PROBABLE", "INFERRED"],
  LIKELY: ["INFERRED", "SPECULATIVE"],
  UNVERIFIED: ["PROBABLE", "INFERRED", "SPECULATIVE"],
  NOT_REPRODUCED: ["PROBABLE", "INFERRED", "SPECULATIVE"],
  FALSE_POSITIVE: ["SPECULATIVE"],
  NOT_APPLICABLE: ["INFERRED", "SPECULATIVE"]
};
function allowedConfidenceLevels(verificationStatus) {
  if (!verificationStatus) {
    return ALLOWED_BY_VERIFICATION.UNVERIFIED;
  }
  return ALLOWED_BY_VERIFICATION[verificationStatus] ?? ALLOWED_BY_VERIFICATION.UNVERIFIED;
}
function enforceAllowedConfidence(verificationStatus, proposed) {
  const allowed = allowedConfidenceLevels(verificationStatus);
  if (allowed.includes(proposed)) return proposed;
  return allowed[0];
}
function assertConfidenceVerificationInvariant(verificationStatus, confidenceLevel) {
  if (verificationStatus === "CONFIRMED" && confidenceLevel !== "VERIFIED") {
    throw new Error(
      `Confidence invariant violated: CONFIRMED findings must use VERIFIED confidence (got ${confidenceLevel})`
    );
  }
  const allowed = allowedConfidenceLevels(verificationStatus);
  if (!allowed.includes(confidenceLevel)) {
    throw new Error(
      `Confidence invariant violated: ${verificationStatus ?? "unknown"} cannot carry ${confidenceLevel}`
    );
  }
}

// brain/confidence/derive.ts
var CONFIDENCE_LEVEL_LABELS = {
  VERIFIED: "Verified",
  PROBABLE: "Probable",
  INFERRED: "Inferred",
  SPECULATIVE: "Speculative"
};
function confidenceLevelFromNumericScore(score, context) {
  const clamped = Math.min(0.99, Math.max(0.05, score));
  if (context?.suppressed) return "SPECULATIVE";
  if (context?.llmOnly && !context.hasRuntimeEvidence) return "SPECULATIVE";
  if (context?.hasRuntimeEvidence && (context.detectionMethod === "LIVE_VERIFICATION" || context.detectionMethod === "AUTHORIZED_STAGING" || context.detectionMethod === "DYNAMIC_ANALYSIS" || clamped >= 0.88)) {
    return "VERIFIED";
  }
  if (context?.hasReplayEvidence || clamped >= 0.75) return "PROBABLE";
  if (clamped >= 0.55) return "INFERRED";
  return "SPECULATIVE";
}
function confidenceLevelFromLegacyBand(band, context) {
  const normalized = String(band ?? "medium").toLowerCase();
  if (context?.verificationStatus === "CONFIRMED") return "VERIFIED";
  if (context?.hasRuntimeEvidence && normalized === "high") return "VERIFIED";
  if (normalized === "high") return "PROBABLE";
  if (normalized === "medium") return "INFERRED";
  return "SPECULATIVE";
}
function confidenceLevelFromExternalLabel(label) {
  const normalized = String(label ?? "MEDIUM").toUpperCase();
  if (normalized === "HIGH") return "PROBABLE";
  if (normalized === "MEDIUM") return "INFERRED";
  return "SPECULATIVE";
}
function deriveConfidenceLevel(input) {
  let proposed;
  if (input.verificationStatus === "CONFIRMED") {
    proposed = "VERIFIED";
  } else if (input.numericScore != null && Number.isFinite(input.numericScore)) {
    proposed = confidenceLevelFromNumericScore(input.numericScore, input);
  } else if (input.legacyExternal) {
    proposed = confidenceLevelFromExternalLabel(input.legacyExternal);
  } else if (input.legacyBand) {
    proposed = confidenceLevelFromLegacyBand(input.legacyBand, input);
  } else if (input.detectionMethod) {
    const computed = computeConfidenceScore({
      detectionMethod: input.detectionMethod,
      evidenceItems: input.evidenceItems ?? [],
      severity: input.severity ?? "medium",
      hasRuntimeEvidence: Boolean(input.hasRuntimeEvidence),
      hasReplayEvidence: Boolean(input.hasReplayEvidence),
      signalHits: input.signalHits
    });
    proposed = confidenceLevelFromNumericScore(computed.confidence, input);
  } else {
    proposed = "INFERRED";
  }
  return enforceAllowedConfidence(input.verificationStatus ?? null, proposed);
}
function deriveConfidenceFromEvidenceScore(input) {
  const { confidence, explanation } = computeConfidenceScore({
    detectionMethod: input.detectionMethod,
    evidenceItems: input.evidenceItems,
    severity: input.severity,
    hasRuntimeEvidence: Boolean(input.hasRuntimeEvidence),
    hasReplayEvidence: Boolean(input.hasReplayEvidence),
    signalHits: input.signalHits
  });
  const level = deriveConfidenceLevel({
    numericScore: confidence,
    detectionMethod: input.detectionMethod,
    evidenceItems: input.evidenceItems,
    severity: input.severity,
    hasRuntimeEvidence: input.hasRuntimeEvidence,
    hasReplayEvidence: input.hasReplayEvidence,
    signalHits: input.signalHits,
    verificationStatus: input.verificationStatus,
    suppressed: input.suppressed,
    llmOnly: input.llmOnly
  });
  return { level, numericScore: confidence, explanation };
}
function legacyBandFromConfidenceLevel(level) {
  if (level === "VERIFIED" || level === "PROBABLE") return "high";
  if (level === "INFERRED") return "medium";
  return "low";
}
function isHighConfidenceLevel(level) {
  return level === "VERIFIED" || level === "PROBABLE";
}
function summarizeConfidenceDistribution(levels) {
  const summary = emptyConfidenceDistribution();
  for (const level of levels) {
    summary[level] += 1;
  }
  return summary;
}
function formatConfidenceDistribution(summary) {
  return Object.entries(summary).filter(([, count]) => count > 0).map(([level, count]) => `${count} ${CONFIDENCE_LEVEL_LABELS[level]}`).join(", ");
}

// brain/evidence-finding/schema.ts
var DETECTION_METHODS = [
  "STATIC_ANALYSIS",
  "DYNAMIC_ANALYSIS",
  "REPLAY",
  "MOCK_SIMULATION",
  "AUTHORIZED_STAGING",
  "LIVE_VERIFICATION",
  "HYBRID"
];
var FINDING_CONFIRMATION_STATUSES = [
  "confirmed",
  "potential_vulnerability",
  "not_exploitable",
  "inconclusive",
  "suppressed"
];
var evidenceItemSchema = external_exports.object({
  id: external_exports.string(),
  kind: external_exports.string(),
  label: external_exports.string(),
  detail: external_exports.string().optional(),
  confidence: external_exports.number().min(0).max(1).optional(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
});
var ruleInfoSchema = external_exports.object({
  ruleId: external_exports.string(),
  ruleName: external_exports.string(),
  ruleDescription: external_exports.string().optional(),
  category: external_exports.string(),
  owasp: external_exports.array(external_exports.string()).optional(),
  cwe: external_exports.array(external_exports.string()).optional(),
  mitreAttack: external_exports.array(external_exports.string()).optional()
});
var fileLocationSchema = external_exports.object({
  path: external_exports.string(),
  line: external_exports.number().int().min(1).optional(),
  column: external_exports.number().int().min(1).optional(),
  matchedRule: external_exports.string().optional()
});
var evidenceReportSchema = external_exports.object({
  version: external_exports.literal(1),
  detectionMethod: external_exports.enum(DETECTION_METHODS),
  confidence: external_exports.number().min(0).max(1),
  confidenceLevel: external_exports.enum(CONFIDENCE_LEVELS).optional(),
  confidencePercent: external_exports.number().int().min(0).max(100),
  confidenceExplanation: external_exports.string(),
  falsePositiveProbability: external_exports.number().min(0).max(1),
  falsePositivePercent: external_exports.number().int().min(0).max(100),
  falsePositiveExplanation: external_exports.string(),
  confirmationStatus: external_exports.enum(FINDING_CONFIRMATION_STATUSES),
  statusLabel: external_exports.string(),
  evidence: external_exports.array(evidenceItemSchema),
  counterEvidence: external_exports.array(evidenceItemSchema),
  reasoning: external_exports.string(),
  affectedFiles: external_exports.array(fileLocationSchema),
  matchedRules: external_exports.array(ruleInfoSchema),
  runtimeEvidence: external_exports.array(evidenceItemSchema).optional(),
  replayEvidence: external_exports.array(evidenceItemSchema).optional(),
  verificationStatus: external_exports.string().optional(),
  recommendedFix: external_exports.string().optional(),
  safeFixConfidence: external_exports.number().min(0).max(1).optional(),
  projectType: external_exports.string().optional()
});
var EVIDENCE_REPORT_METADATA_KEY = "evidenceReport";
function resolveEvidenceReportConfidenceLevel(report) {
  if (report.confidenceLevel) return report.confidenceLevel;
  return deriveConfidenceLevel({
    numericScore: report.confidence,
    detectionMethod: report.detectionMethod,
    hasRuntimeEvidence: Boolean(report.runtimeEvidence?.length),
    hasReplayEvidence: Boolean(report.replayEvidence?.length),
    suppressed: report.confirmationStatus === "suppressed",
    verificationStatus: report.confirmationStatus === "confirmed" ? "CONFIRMED" : report.confirmationStatus === "suppressed" ? "UNVERIFIED" : "POTENTIAL"
  });
}
function withEvidenceReportConfidenceLevel(report) {
  return {
    ...report,
    confidenceLevel: resolveEvidenceReportConfidenceLevel(report)
  };
}
function parseEvidenceReport(value) {
  const parsed = evidenceReportSchema.safeParse(value);
  return parsed.success ? withEvidenceReportConfidenceLevel(parsed.data) : null;
}
function evidenceReportFromMetadata(metadata) {
  if (!metadata) return null;
  return parseEvidenceReport(metadata[EVIDENCE_REPORT_METADATA_KEY]);
}

// features/security-scanner/constants.ts
var DEFAULT_IGNORED_SEGMENTS = [
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "target",
  ".cache",
  // Static assets served as-is (bundler/esbuild output, service workers, ...).
  // Nobody hand-writes or reviews this file-by-file -- same rationale as dist/build.
  "public"
];
var DEFAULT_BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".7z",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".dll",
  ".doc",
  ".docx",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip"
]);
var SOURCE_EXTENSIONS = /* @__PURE__ */ new Set([
  ".cjs",
  ".env",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".prisma",
  ".rules",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);
var SEVERITY_WEIGHT = {
  critical: 25,
  high: 15,
  medium: 7,
  low: 2,
  info: 0
};
var SECRET_NAME_PATTERN = /(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|client[_-]?secret|access[_-]?key)/i;
var CLIENT_ENV_PREFIX_PATTERN = /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_)/;

// features/security-scanner/rules/secret-classification.ts
var SECRET_CLASSIFICATION_METADATA_KEY = "secretClassification";
var TEST_OR_EXAMPLE = /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\./i;
var REAL_CREDENTIAL_PATTERNS = [
  /\bsk_live_[A-Za-z0-9]{12,}\b/,
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/
];
var PLACEHOLDER_VALUE = /(?:example|sample|placeholder|your[_-]|change[_-]?me|xxx|test[_-]?key|process\.env|\$\{|generate-a|long-random|seq_live_\.\.\.|\.\.\.|not-a-real|replace-me|insert[-_]|fake[-_]|dummy)/i;
var TEST_FIXTURE_VALUE = /(?:^|[_./-])(?:mock|fake|dummy|sample|placeholder|test)(?:[_./-]|$)|(?:[_./-](?:test|mock|fake|dummy|sample|placeholder)(?:[_./-]|$))|(?:^test[_./-])|(?:oauth[_./-].*[_./-]test[_./-])|(?:[_./-]test[_./-](?:token|key|secret|credential|password|refresh))/i;
var MOCK_CONTEXT = /\b(?:vi\.mock|vi\.fn|jest\.mock|mockResolvedValue|mockImplementation|mockReturnValue|test fixture|fake provider|test provider|fixture|stub|test environment|beforeEach|describe\(|it\()\b/i;
var REAL_SECRET_CONTEXT = /\b(?:Authorization:\s*Bearer|Bearer\s+[A-Za-z0-9._-]+|createClient\s*\(|new\s+[A-Z][A-Za-z0-9]*Client|process\.env\.[A-Z0-9_]+|DATABASE_URL|apiKey|secretKey|credentials|authenticate|signIn|getAuth|serviceRole|connectionString)\b/i;
function isTestOrExampleFile(path) {
  return TEST_OR_EXAMPLE.test(path);
}
function matchesRealCredentialFormat(value) {
  return REAL_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}
function isNonBlockingSecretClassification(classification) {
  return classification === "TEST_FIXTURE" || classification === "PLACEHOLDER" || classification === "FALSE_POSITIVE";
}
function contextWindow(lines, lineIndex, radius = 4) {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  return lines.slice(start, end).join("\n");
}
function shannonEntropy(value) {
  if (!value) return 0;
  const counts = /* @__PURE__ */ new Map();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  const maxEntropy = Math.log2(Math.min(value.length, 256));
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}
function looksLikeTestFixtureSecretValue(value) {
  if (!value || matchesRealCredentialFormat(value)) return false;
  if (PLACEHOLDER_VALUE.test(value)) return true;
  if (TEST_FIXTURE_VALUE.test(value)) return true;
  if (/^lab[_./-]/i.test(value)) return true;
  return false;
}
function classifySecretDetection(input) {
  const { path, value, variableName, line, lineIndex, fileLines } = input;
  const signals = [];
  if (!value) {
    return { classification: "FALSE_POSITIVE", signals: ["empty_value"], confidence: "high" };
  }
  if (matchesRealCredentialFormat(value)) {
    return {
      classification: "REAL_SECRET",
      signals: ["known_credential_format"],
      confidence: "high"
    };
  }
  if (/^[a-zA-Z_$][\w$]*\(\)$/.test(value) || /^[a-z][a-zA-Z0-9_$]*$/.test(value) && value.length < 32 && !/\d{4,}/.test(value)) {
    return {
      classification: "FALSE_POSITIVE",
      signals: ["identifier_not_literal"],
      confidence: "high"
    };
  }
  if (variableName && /_PREFIX$/i.test(variableName)) {
    return {
      classification: "FALSE_POSITIVE",
      signals: ["prefix_constant_name"],
      confidence: "high"
    };
  }
  if (isTestOrExampleFile(path) && looksLikeTestFixtureSecretValue(value)) {
    return {
      classification: "TEST_FIXTURE",
      signals: ["test_file_path", "test_fixture_value_pattern"],
      confidence: "high"
    };
  }
  if (PLACEHOLDER_VALUE.test(value)) {
    return {
      classification: "PLACEHOLDER",
      signals: ["placeholder_semantics"],
      confidence: "high"
    };
  }
  let fixtureScore = 0;
  let realScore = 0;
  if (isTestOrExampleFile(path)) {
    fixtureScore += 1;
    signals.push("test_file_path");
  }
  if (looksLikeTestFixtureSecretValue(value)) {
    fixtureScore += 2;
    signals.push("test_fixture_value_pattern");
  }
  const nearby = `${contextWindow(fileLines, lineIndex)}
${line}`;
  if (MOCK_CONTEXT.test(nearby)) {
    fixtureScore += 2;
    signals.push("mock_test_context");
  }
  if (REAL_SECRET_CONTEXT.test(nearby)) {
    realScore += 2;
    signals.push("production_auth_context");
  }
  const entropy = shannonEntropy(value);
  if (entropy >= 0.62 && value.length >= 16) {
    realScore += 1;
    signals.push("high_entropy");
  } else if (entropy <= 0.45 && value.length <= 32) {
    fixtureScore += 1;
    signals.push("low_entropy_readable");
  }
  if (variableName && SECRET_NAME_PATTERN.test(variableName)) {
    realScore += 0.5;
    signals.push("secret_variable_name");
  }
  if (fixtureScore >= 3 && realScore < 2) {
    return { classification: "TEST_FIXTURE", signals, confidence: "high" };
  }
  if (fixtureScore >= 2 && realScore === 0) {
    return { classification: "TEST_FIXTURE", signals, confidence: "high" };
  }
  if (realScore >= 2) {
    return {
      classification: realScore >= 2.5 ? "PROBABLE_SECRET" : "POTENTIAL_SECRET",
      signals,
      confidence: "medium"
    };
  }
  if (realScore >= 1 || entropy >= 0.55) {
    return { classification: "POTENTIAL_SECRET", signals, confidence: "medium" };
  }
  if (fixtureScore >= 1) {
    return { classification: "TEST_FIXTURE", signals, confidence: "medium" };
  }
  return { classification: "POTENTIAL_SECRET", signals, confidence: "low" };
}
function severityForSecretClassification(classification) {
  switch (classification) {
    case "REAL_SECRET":
      return "high";
    case "PROBABLE_SECRET":
      return "high";
    case "POTENTIAL_SECRET":
      return "high";
    case "TEST_FIXTURE":
    case "PLACEHOLDER":
    case "FALSE_POSITIVE":
      return "info";
  }
}
function confidenceForSecretClassification(classification, modelConfidence) {
  if (isNonBlockingSecretClassification(classification)) return "low";
  return modelConfidence;
}
function resolveSecretClassification(input) {
  const fromMetadata = input.metadata?.[SECRET_CLASSIFICATION_METADATA_KEY];
  if (typeof fromMetadata === "string") {
    return fromMetadata;
  }
  return inferSecretClassificationFromPersistedFinding(input);
}
function inferSecretClassificationFromPersistedFinding(input) {
  if ((input.ruleId ?? "").toLowerCase() !== "secrets.exposed") return void 0;
  const path = input.filePath ?? "";
  if (!path || !isTestOrExampleFile(path)) return void 0;
  const evidence = (input.evidence ?? "").trim();
  if (/^credential=\[REDACTED\]$/i.test(evidence)) {
    return void 0;
  }
  if (/^[A-Za-z0-9_]+=\[REDACTED\]$/.test(evidence)) {
    return "TEST_FIXTURE";
  }
  return "TEST_FIXTURE";
}

// brain/production-verdict/secret-classification.ts
function isNonBlockingSecretFinding(input) {
  if ((input.ruleId ?? "").toLowerCase() !== "secrets.exposed") return false;
  const classification = resolveSecretClassification({
    ruleId: input.ruleId,
    filePath: input.filePath ?? input.file_path ?? null,
    evidence: input.evidence ?? null,
    metadata: input.metadata ?? null
  });
  return isNonBlockingSecretClassification(classification);
}

// brain/production-verdict/normalize-finding.ts
var HIGH_CONFIDENCE_RULES = /* @__PURE__ */ new Set([
  "hardcoded-secret",
  "exposed-api-key",
  "exposed-credential",
  "secrets.exposed",
  "sql-injection",
  "missing-auth",
  "missing-rls",
  "admin-endpoint-unprotected"
]);
function normalizeFinding(input) {
  const severityRaw = (input.severity ?? "medium").toLowerCase();
  const ruleId = input.rule_id ?? input.rule ?? void 0;
  const category = (input.category ?? "general").toLowerCase();
  const secretClassification = resolveSecretClassification({
    ruleId,
    filePath: input.file_path ?? null,
    evidence: input.evidence ?? null,
    metadata: input.metadata ?? null
  });
  const embeddedReport = evidenceReportFromMetadata(input.metadata ?? null) ?? parseEvidenceReport(input.metadata?.evidenceReport);
  let severity = ["critical", "high", "medium", "low", "info"].includes(severityRaw) ? severityRaw : "medium";
  if (secretClassification && isNonBlockingSecretClassification(secretClassification)) {
    severity = severityForSecretClassification(secretClassification);
  }
  let confidenceLevel = "INFERRED";
  if (isNonBlockingSecretFinding({
    ruleId,
    file_path: input.file_path,
    evidence: input.evidence,
    metadata: input.metadata ?? null
  })) {
    confidenceLevel = "SPECULATIVE";
  } else if (embeddedReport) {
    confidenceLevel = resolveEvidenceReportConfidenceLevel(embeddedReport);
  } else if (ruleId && HIGH_CONFIDENCE_RULES.has(ruleId.toLowerCase())) {
    confidenceLevel = "PROBABLE";
  } else if (severity === "critical") {
    confidenceLevel = "PROBABLE";
  } else if (severity === "info") {
    confidenceLevel = "SPECULATIVE";
  }
  if (!embeddedReport && typeof input.confidence === "number" && input.confidence >= 0.8) {
    confidenceLevel = deriveConfidenceLevel({
      numericScore: input.confidence,
      legacyBand: "high"
    });
  } else if (!embeddedReport && typeof input.confidence === "string") {
    confidenceLevel = deriveConfidenceLevel({ legacyBand: input.confidence });
  }
  const confidence = legacyBandFromConfidenceLevel(confidenceLevel);
  return {
    id: input.id ?? `${ruleId ?? "finding"}-${input.file_path ?? "unknown"}`,
    title: input.title,
    severity,
    category,
    ruleId,
    filePath: input.file_path ?? void 0,
    line: input.start_line ?? void 0,
    recommendation: input.recommendation ?? embeddedReport?.recommendedFix ?? void 0,
    confidence,
    confidenceLevel,
    confidencePercent: embeddedReport?.confidencePercent,
    falsePositivePercent: embeddedReport?.falsePositivePercent,
    detectionMethod: embeddedReport?.detectionMethod,
    statusLabel: embeddedReport?.statusLabel,
    evidence: input.evidence ?? void 0,
    evidenceReport: embeddedReport,
    secretClassification
  };
}
function isCriticalSignal(finding) {
  if (isNonBlockingSecretClassification(finding.secretClassification)) {
    return false;
  }
  const haystack = `${finding.title} ${finding.category} ${finding.ruleId ?? ""}`.toLowerCase();
  return finding.severity === "critical" || finding.severity === "high" && isHighConfidenceLevel(finding.confidenceLevel) && (haystack.includes("secret") || haystack.includes("credential") || haystack.includes("admin") || haystack.includes("rce") || haystack.includes("remote code"));
}

// brain/production-verdict/priorities.ts
var GROUP_PATTERNS = [
  {
    pattern: /auth|login|session|jwt|oauth|middleware/i,
    title: "Harden authentication and session handling",
    category: "authentication"
  },
  {
    pattern: /authoriz|ownership|permission|access control|rls|policy/i,
    title: "Protect resource ownership checks",
    category: "authorization"
  },
  {
    pattern: /secret|credential|api.?key|token|password/i,
    title: "Revoke exposed credentials and rotate secrets",
    category: "data_protection"
  },
  {
    pattern: /rate.?limit|throttle|dos/i,
    title: "Add rate limiting to sensitive endpoints",
    category: "deployment"
  },
  {
    pattern: /admin|privileged|elevated/i,
    title: "Protect admin endpoints and privileged routes",
    category: "authorization"
  },
  {
    pattern: /sql|injection|xss|csrf/i,
    title: "Fix injection and input validation risks",
    category: "security"
  },
  {
    pattern: /env|config|deployment|vercel|supabase/i,
    title: "Fix deployment and environment configuration",
    category: "deployment"
  }
];
function groupKey(finding) {
  for (const group of GROUP_PATTERNS) {
    if (group.pattern.test(`${finding.title} ${finding.category} ${finding.ruleId ?? ""}`)) {
      return group.title;
    }
  }
  return finding.title;
}
function severityWeight(severity) {
  switch (severity) {
    case "critical":
      return 100;
    case "high":
      return 70;
    case "medium":
      return 30;
    case "low":
      return 10;
    default:
      return 0;
  }
}
function confidenceWeight(finding) {
  return isHighConfidenceLevel(finding.confidenceLevel) ? 1 : finding.confidenceLevel === "INFERRED" ? 0.7 : 0.4;
}
function selectTopPriorities(findings) {
  const blockers = findings.filter(
    (f) => (f.severity === "critical" || f.severity === "high") && !isNonBlockingSecretClassification(f.secretClassification)
  );
  const candidates = blockers.length > 0 ? blockers : findings.filter((f) => f.severity === "medium");
  const groups = /* @__PURE__ */ new Map();
  for (const finding of candidates) {
    const key = groupKey(finding);
    const groupMeta = GROUP_PATTERNS.find((g) => g.title === key);
    const existing = groups.get(key) ?? {
      title: groupMeta?.title ?? finding.title,
      category: groupMeta?.category ?? finding.category,
      findings: [],
      score: 0
    };
    existing.findings.push(finding);
    existing.score += severityWeight(finding.severity) * confidenceWeight(finding) * (finding.filePath ? 1.1 : 1);
    groups.set(key, existing);
  }
  const sorted = Array.from(groups.values()).sort((a, b) => b.score - a.score).slice(0, 3);
  return sorted.map((group, index) => {
    const topFinding = group.findings.sort(
      (a, b) => severityWeight(b.severity) - severityWeight(a.severity)
    )[0];
    const files = Array.from(
      new Set(group.findings.map((f) => f.filePath).filter((f) => Boolean(f)))
    );
    return {
      id: `priority-${index + 1}-${group.category}`,
      rank: index + 1,
      title: group.title,
      category: group.category,
      reason: `${group.findings.length} related finding${group.findings.length === 1 ? "" : "s"} affect production readiness.`,
      severity: topFinding.severity,
      confidence: topFinding.confidence,
      confidenceLevel: topFinding.confidenceLevel,
      estimatedMinutes: 0,
      // filled by fix-time module
      estimatedTimeLabel: "",
      projectedScoreImpact: 0,
      // filled by projection module
      affectedFiles: files.slice(0, 5),
      recommendedAction: topFinding.recommendation ?? `Review and fix ${group.title.toLowerCase()} before shipping.`,
      findingIds: group.findings.map((f) => f.id)
    };
  });
}

// brain/production-verdict/projection.ts
var SEVERITY_PENALTY = {
  critical: 12,
  high: 6,
  medium: 2,
  low: 1,
  info: 0
};
function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function scoreFromFindings(securityScore, findings) {
  let penalty = 0;
  for (const finding of findings) {
    penalty += SEVERITY_PENALTY[finding.severity] ?? 0;
    if (finding.confidence === "high" && finding.severity === "critical") {
      penalty += 4;
    }
  }
  return clampScore(securityScore - penalty * 0.35);
}
function calculateHonestScore(input) {
  if (!input.hasSufficientCoverage) return null;
  if (input.securityScore === null) return null;
  return scoreFromFindings(input.securityScore, input.findings);
}
function projectScoreAfterPriorities(input) {
  if (input.currentScore === null || input.securityScore === null) {
    return { projectedScore: null, impacts: [] };
  }
  const resolvedIds = new Set(input.priorities.flatMap((p2) => p2.findingIds));
  const remaining = input.allFindings.filter((f) => !resolvedIds.has(f.id));
  const projected = scoreFromFindings(input.securityScore, remaining);
  const impacts = input.priorities.map((priority) => {
    const withoutGroup = input.allFindings.filter((f) => !priority.findingIds.includes(f.id));
    const withGroup = input.allFindings;
    const scoreWithout = scoreFromFindings(input.securityScore, withoutGroup);
    const scoreWith = scoreFromFindings(input.securityScore, withGroup);
    return Math.max(0, scoreWithout - scoreWith);
  });
  return {
    projectedScore: projected,
    impacts: impacts.map((impact, index) => Math.max(impacts[index] ?? impact, 3))
  };
}
function applyProjectedImpacts(priorities, impacts) {
  return priorities.map((priority, index) => ({
    ...priority,
    projectedScoreImpact: impacts[index] ?? 3
  }));
}

// brain/production-verdict/schema.ts
var PRODUCTION_VERDICT_VERSION = "1.0.0";
var VerdictStatusSchema = external_exports.enum([
  "ready_to_ship",
  "almost_ready",
  "needs_improvement",
  "not_ready",
  "insufficient_data",
  "analysis_failed"
]);
var VERDICT_STATUS_LABELS = {
  ready_to_ship: "Ready to Ship",
  almost_ready: "Almost Ready",
  needs_improvement: "Needs Improvement",
  not_ready: "Not Ready to Ship",
  insufficient_data: "More Analysis Required",
  analysis_failed: "Analysis Failed"
};
var AreaKeySchema = external_exports.enum([
  "security",
  "authentication",
  "authorization",
  "data_protection",
  "dependencies",
  "architecture",
  "testing",
  "performance",
  "deployment",
  "observability",
  "database",
  "reliability"
]);
var AreaStatusSchema = external_exports.enum(["evaluated", "partial", "not_evaluated"]);
var ProductionAreaAssessmentSchema = external_exports.object({
  key: AreaKeySchema,
  label: external_exports.string(),
  status: AreaStatusSchema,
  score: external_exports.number().min(0).max(100).nullable(),
  confidence: external_exports.enum(["high", "medium", "low"]),
  evidenceCount: external_exports.number().int().min(0),
  methodology: external_exports.string(),
  limitations: external_exports.string().optional()
});
var ProductionPrioritySchema = external_exports.object({
  id: external_exports.string(),
  rank: external_exports.number().int().min(1).max(3),
  title: external_exports.string(),
  category: external_exports.string(),
  reason: external_exports.string(),
  severity: external_exports.enum(["critical", "high", "medium", "low", "info"]),
  confidence: external_exports.enum(["high", "medium", "low"]),
  confidenceLevel: external_exports.enum(CONFIDENCE_LEVELS).optional(),
  estimatedMinutes: external_exports.number().int().min(0),
  estimatedTimeLabel: external_exports.string(),
  projectedScoreImpact: external_exports.number().min(0).max(100),
  affectedFiles: external_exports.array(external_exports.string()),
  recommendedAction: external_exports.string(),
  findingIds: external_exports.array(external_exports.string())
});
var ProductionVerdictSchema = external_exports.object({
  version: external_exports.string(),
  projectId: external_exports.string().uuid(),
  repositoryId: external_exports.string().uuid(),
  scanId: external_exports.string().uuid(),
  commitSha: external_exports.string().nullable(),
  branch: external_exports.string().nullable(),
  status: VerdictStatusSchema,
  score: external_exports.number().min(0).max(100).nullable(),
  previousScore: external_exports.number().min(0).max(100).nullable(),
  scoreDelta: external_exports.number().nullable(),
  projectedScore: external_exports.number().min(0).max(100).nullable(),
  projectedScoreIsEstimate: external_exports.boolean(),
  blockersCount: external_exports.number().int().min(0),
  criticalBlockersCount: external_exports.number().int().min(0),
  highBlockersCount: external_exports.number().int().min(0),
  estimatedFixMinutes: external_exports.number().int().min(0),
  confidence: external_exports.enum(["high", "medium", "low"]),
  executiveSummary: external_exports.string(),
  topPriorities: external_exports.array(ProductionPrioritySchema).max(3),
  evaluatedAreas: external_exports.array(ProductionAreaAssessmentSchema),
  partiallyEvaluatedAreas: external_exports.array(ProductionAreaAssessmentSchema),
  unevaluatedAreas: external_exports.array(ProductionAreaAssessmentSchema),
  introducedBlockers: external_exports.number().int().min(0),
  resolvedBlockers: external_exports.number().int().min(0),
  coverageRatio: external_exports.number().min(0).max(1).nullable(),
  filesAnalyzed: external_exports.number().int().min(0),
  findingsCount: external_exports.number().int().min(0),
  recommendedAction: external_exports.string(),
  methodologyNote: external_exports.string(),
  generatedAt: external_exports.string().datetime(),
  /** Unified platform convergence — authoritative decision linkage */
  correlationId: external_exports.string().uuid().optional(),
  scanExecutionId: external_exports.string().uuid().optional(),
  securityDecisionId: external_exports.string().uuid().optional(),
  securityDeploymentVerdict: external_exports.string().optional(),
  attackSimulation: external_exports.object({
    campaignId: external_exports.string().uuid().nullable(),
    campaignStatus: external_exports.string(),
    totalExecutions: external_exports.number().int().min(0),
    confirmedFindings: external_exports.number().int().min(0),
    notExploitableFindings: external_exports.number().int().min(0),
    protectedExecutions: external_exports.number().int().min(0),
    stillVulnerableExecutions: external_exports.number().int().min(0),
    blockedExecutions: external_exports.number().int().min(0),
    pendingReplay: external_exports.number().int().min(0),
    headline: external_exports.string()
  }).optional()
});

// brain/production-verdict/config.ts
var VERDICT_THRESHOLDS = {
  readyToShipScore: 85,
  almostReadyScore: 70,
  needsImprovementScore: 25,
  maxHighBlockersForAlmostReady: 2,
  maxHighBlockersForReady: 0,
  minCoverageRatio: 0.15,
  minFilesAnalyzed: 3,
  scoreDropSignificant: 5
};

// brain/production-verdict/status-rules.ts
function determineVerdictStatus(input) {
  if (input.scanStatus === "failed") {
    return "analysis_failed";
  }
  if (input.partialScanFailure) {
    return "insufficient_data";
  }
  if (!input.hasSufficientCoverage) {
    return "insufficient_data";
  }
  if (input.score === null && input.criticalBlockersCount === 0 && input.highBlockersCount === 0) {
    return "insufficient_data";
  }
  const criticalSignals = input.findings.filter(isCriticalSignal);
  const exposedSecret = input.findings.some((f) => {
    if (isNonBlockingSecretClassification(f.secretClassification)) return false;
    const hay = `${f.title} ${f.category} ${f.ruleId ?? ""}`.toLowerCase();
    return f.severity === "critical" && isHighConfidenceLevel(f.confidenceLevel) && (hay.includes("secret") || hay.includes("credential") || hay.includes("api key"));
  });
  if (input.criticalBlockersCount > 0 || criticalSignals.length > 0 || exposedSecret) {
    return "not_ready";
  }
  const score = input.score ?? 0;
  if (score >= VERDICT_THRESHOLDS.readyToShipScore && input.highBlockersCount <= VERDICT_THRESHOLDS.maxHighBlockersForReady) {
    return "ready_to_ship";
  }
  if (score >= VERDICT_THRESHOLDS.almostReadyScore && input.highBlockersCount <= VERDICT_THRESHOLDS.maxHighBlockersForAlmostReady) {
    return "almost_ready";
  }
  if (score >= VERDICT_THRESHOLDS.needsImprovementScore) {
    return "needs_improvement";
  }
  return "not_ready";
}
function verdictHeadline(status) {
  switch (status) {
    case "ready_to_ship":
      return "READY TO SHIP";
    case "almost_ready":
      return "ALMOST READY";
    case "needs_improvement":
      return "NEEDS IMPROVEMENT";
    case "not_ready":
      return "NOT READY TO SHIP";
    case "insufficient_data":
      return "MORE ANALYSIS REQUIRED";
    case "analysis_failed":
      return "ANALYSIS FAILED";
  }
}
function recommendedAction(status, blockersCount) {
  switch (status) {
    case "ready_to_ship":
      return "Deploy when your release process is ready. SequrAI will review every subsequent push.";
    case "almost_ready":
      return "Resolve the remaining blockers on your fastest path forward, then re-run the analysis.";
    case "needs_improvement":
      return blockersCount > 0 ? "Start with priority 1 on the fastest path forward before shipping to production." : "Address the top improvements to increase your Production Ready Score.";
    case "not_ready":
      return "Do not ship until production blockers are resolved. Start with priority 1.";
    case "insufficient_data":
      return "Run a full production analysis with sufficient repository coverage before shipping.";
    case "analysis_failed":
      return "Review the scan error and re-run the analysis when the issue is resolved.";
  }
}
function overallConfidence(input) {
  if (input.status === "insufficient_data" || input.status === "analysis_failed") {
    return "low";
  }
  if (input.filesAnalyzed >= 20 && input.findingsCount >= 0) return "high";
  if (input.filesAnalyzed >= 5) return "medium";
  return "low";
}

// brain/production-verdict/summary.ts
function buildDeterministicSummary(verdict, blockerConfidence) {
  const label = VERDICT_STATUS_LABELS[verdict.status];
  const scorePart = verdict.score != null ? `Production Ready Score is ${verdict.score}/100.` : "Score unavailable due to limited coverage.";
  if (verdict.status === "insufficient_data") {
    return `${label}. SequrAI did not analyze enough of the repository to issue a confident production decision. Run a full analysis first.`;
  }
  if (verdict.status === "analysis_failed") {
    return `${label}. The scan did not complete successfully. Review the error and re-run the analysis.`;
  }
  if (verdict.status === "ready_to_ship") {
    return `${label}. ${scorePart} No production blockers detected. Your application meets the current readiness threshold.`;
  }
  const blockerPart = verdict.blockersCount > 0 ? `${verdict.blockersCount} production blocker${verdict.blockersCount === 1 ? "" : "s"} (${verdict.criticalBlockersCount} critical, ${verdict.highBlockersCount} high) prevent safe deployment.${blockerConfidence && formatConfidenceDistribution(blockerConfidence) ? ` Evidence strength: ${formatConfidenceDistribution(blockerConfidence)}.` : ""}` : "No critical blockers, but improvements remain before shipping.";
  const priorityPart = verdict.topPriorities.length > 0 ? ` Start with: ${verdict.topPriorities[0].title}.` : "";
  const coveragePart = verdict.unevaluatedAreas.length > 0 ? ` Note: ${verdict.unevaluatedAreas.length} areas are not yet evaluated (including performance and testing).` : "";
  return `${label}. ${scorePart} ${blockerPart}${priorityPart}${coveragePart}`;
}
function buildMethodologyNote(verdict) {
  const evaluated = verdict.evaluatedAreas.map((a) => a.label).join(", ");
  const partial2 = verdict.partiallyEvaluatedAreas.map((a) => a.label).join(", ");
  const skipped = verdict.unevaluatedAreas.map((a) => a.label).join(", ");
  const parts = [
    evaluated ? `Evaluated: ${evaluated}.` : "",
    partial2 ? `Partially evaluated: ${partial2}.` : "",
    skipped ? `Not evaluated: ${skipped}.` : ""
  ].filter(Boolean);
  return `Score v1 is primarily driven by static security analysis. ${parts.join(" ")}`.trim();
}

// brain/production-verdict/engine.ts
function countBlockers(findings) {
  const blockers = findings.filter(
    (finding) => (finding.severity === "critical" || finding.severity === "high") && !isNonBlockingSecretClassification(finding.secretClassification)
  );
  const critical = blockers.filter((f) => f.severity === "critical").length;
  const high = blockers.filter((f) => f.severity === "high").length;
  return {
    blockersCount: critical + high,
    criticalBlockersCount: critical,
    highBlockersCount: high
  };
}
function blockerDelta(current, previous) {
  if (previous == null) return { introduced: 0, resolved: 0 };
  if (current > previous) {
    return { introduced: current - previous, resolved: 0 };
  }
  if (current < previous) {
    return { introduced: 0, resolved: previous - current };
  }
  return { introduced: 0, resolved: 0 };
}
function generateProductionVerdict(input) {
  const normalized = input.findings.map(normalizeFinding);
  const filesAnalyzed = input.filesAnalyzed ?? 0;
  const blockers = countBlockers(normalized);
  const coverage = assessCoverage({
    findings: normalized,
    securityScore: input.securityScore,
    filesAnalyzed
  });
  const sufficientCoverage = hasSufficientCoverage({
    filesAnalyzed,
    coverageRatio: coverage.coverageRatio,
    scanStatus: input.scanStatus
  });
  const score = calculateHonestScore({
    securityScore: input.securityScore,
    findings: normalized,
    hasSufficientCoverage: sufficientCoverage
  });
  const status = determineVerdictStatus({
    scanStatus: input.scanStatus,
    score,
    criticalBlockersCount: blockers.criticalBlockersCount,
    highBlockersCount: blockers.highBlockersCount,
    hasSufficientCoverage: sufficientCoverage,
    findings: normalized,
    partialScanFailure: input.partialScanFailure
  });
  let priorities = applyFixTimeEstimates(selectTopPriorities(normalized));
  const projection = projectScoreAfterPriorities({
    currentScore: score,
    securityScore: input.securityScore,
    allFindings: normalized,
    priorities
  });
  priorities = applyProjectedImpacts(priorities, projection.impacts);
  const scoreDelta = input.previousScore != null && score != null ? score - input.previousScore : null;
  const { introduced, resolved } = blockerDelta(
    blockers.blockersCount,
    input.previousBlockersCount
  );
  const blockerConfidence = summarizeConfidenceDistribution(
    normalized.filter(
      (finding) => (finding.severity === "critical" || finding.severity === "high") && !isNonBlockingSecretClassification(finding.secretClassification)
    ).map((finding) => finding.confidenceLevel)
  );
  const baseVerdict = {
    version: PRODUCTION_VERDICT_VERSION,
    projectId: input.projectId,
    repositoryId: input.repositoryId,
    scanId: input.scanId,
    commitSha: input.commitSha ?? null,
    branch: input.branch ?? null,
    status,
    score,
    previousScore: input.previousScore ?? null,
    scoreDelta,
    projectedScore: projection.projectedScore,
    projectedScoreIsEstimate: true,
    blockersCount: blockers.blockersCount,
    criticalBlockersCount: blockers.criticalBlockersCount,
    highBlockersCount: blockers.highBlockersCount,
    estimatedFixMinutes: totalEstimatedMinutes(priorities),
    confidence: overallConfidence({
      status,
      filesAnalyzed,
      findingsCount: normalized.length
    }),
    executiveSummary: "",
    topPriorities: priorities,
    evaluatedAreas: coverage.evaluatedAreas,
    partiallyEvaluatedAreas: coverage.partiallyEvaluatedAreas,
    unevaluatedAreas: coverage.unevaluatedAreas,
    introducedBlockers: introduced,
    resolvedBlockers: resolved,
    coverageRatio: coverage.coverageRatio,
    filesAnalyzed,
    findingsCount: normalized.length,
    recommendedAction: recommendedAction(status, blockers.blockersCount),
    methodologyNote: "",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  baseVerdict.executiveSummary = input.aiExecutiveSummary?.trim() || buildDeterministicSummary(baseVerdict, blockerConfidence);
  baseVerdict.methodologyNote = buildMethodologyNote(baseVerdict);
  const verdict = ProductionVerdictSchema.parse(baseVerdict);
  return {
    verdict,
    meta: {
      engineVersion: PRODUCTION_VERDICT_VERSION,
      findingCount: input.findings.length,
      normalizedFindingCount: normalized.length
    }
  };
}

// features/security-scanner/config.ts
var DEFAULT_SCAN_CONFIG = {
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxFiles: 8e3,
  maxDurationMs: 12e4,
  ignoredSegments: DEFAULT_IGNORED_SEGMENTS,
  includeExtensions: [...SOURCE_EXTENSIONS],
  now: () => Date.now()
};
function resolveConfig(input = {}) {
  return {
    ...DEFAULT_SCAN_CONFIG,
    ...input,
    ignoredSegments: [...input.ignoredSegments ?? DEFAULT_SCAN_CONFIG.ignoredSegments],
    now: input.now ?? DEFAULT_SCAN_CONFIG.now
  };
}

// features/security-scanner/fingerprint.ts
function stableHash(value) {
  let hash2 = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash2 ^= value.charCodeAt(index);
    hash2 = Math.imul(hash2, 16777619);
  }
  return (hash2 >>> 0).toString(16).padStart(8, "0");
}
function findingFingerprint(ruleId, path, line, material = "") {
  return stableHash(`${ruleId}\0${path.toLowerCase()}\0${line}\0${material.trim().toLowerCase()}`);
}

// lib/correlation/finding-identity.ts
function normalizeRepoRelativePath(filePath) {
  const trimmed = filePath.trim().replace(/\\/g, "/");
  const withoutLeading = trimmed.replace(/^\/+/, "");
  const segments = withoutLeading.split("/").filter((segment) => segment && segment !== ".");
  const collapsed = [];
  for (const segment of segments) {
    if (segment === "..") {
      if (collapsed.length > 0) collapsed.pop();
      continue;
    }
    collapsed.push(segment);
  }
  return collapsed.join("/").toLowerCase();
}
function buildFindingCorrelationKey(input) {
  const path = normalizeRepoRelativePath(input.filePath);
  const material = (input.fingerprintMaterial ?? "").trim().toLowerCase();
  return stableHash(`${input.ruleId}\0${path}\0${material}`);
}

// features/security-analysis/sbom/purl.ts
var ECOSYSTEM_TO_PURL_TYPE = {
  npm: "npm",
  pypi: "pypi",
  rubygems: "gem",
  crates: "cargo",
  go: "golang",
  java: "maven"
};
function buildPurl(input) {
  const type = ECOSYSTEM_TO_PURL_TYPE[input.ecosystem] ?? input.ecosystem;
  if (!input.name) return "";
  let qualifiedName;
  if (type === "npm" && input.name.startsWith("@")) {
    const [scope, pkg] = input.name.split("/");
    qualifiedName = `${encodeURIComponent(scope)}/${pkg}`;
  } else if (type === "maven" && input.namespace) {
    qualifiedName = `${input.namespace}/${input.name}`;
  } else if (type === "golang") {
    qualifiedName = input.name;
  } else {
    qualifiedName = input.name;
  }
  const version2 = input.version?.trim();
  return version2 ? `pkg:${type}/${qualifiedName}@${version2}` : `pkg:${type}/${qualifiedName}`;
}
function packageIdentity(input) {
  if (input.purl) return input.purl;
  if (input.namespace) {
    return `${input.ecosystem}:${input.namespace}:${input.name}@${input.version}`;
  }
  return `${input.ecosystem}:${input.name}@${input.version}`;
}

// features/security-analysis/sbom/component.ts
function createSbomComponent(input) {
  const version2 = input.version?.trim() || "unknown";
  return {
    name: input.name,
    version: version2,
    ecosystem: input.ecosystem,
    isDev: input.isDev ?? false,
    isDirect: input.isDirect ?? false,
    namespace: input.namespace,
    lockfilePath: input.lockfilePath,
    purl: buildPurl({
      ecosystem: input.ecosystem,
      name: input.name,
      version: version2,
      namespace: input.namespace
    })
  };
}

// features/security-analysis/sbom/lockfile-parsers.ts
function basename(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
function dedupeComponents(components) {
  const seen = /* @__PURE__ */ new Map();
  for (const component of components) {
    if (!seen.has(component.purl)) {
      seen.set(component.purl, component);
    }
  }
  return [...seen.values()];
}
function parsePackageLockJson(path, content) {
  const lock = JSON.parse(content);
  const packages = lock.packages ?? {};
  const rootEntry = packages[""] ?? {};
  const directNames = /* @__PURE__ */ new Set([
    ...Object.keys(rootEntry.dependencies ?? {}),
    ...Object.keys(rootEntry.devDependencies ?? {}),
    ...Object.keys(rootEntry.optionalDependencies ?? {})
  ]);
  const deps = [];
  for (const [key, info] of Object.entries(packages)) {
    if (key === "" || !info.version) continue;
    const name = key.replace(/^node_modules\//, "").replace(/^.*node_modules\//, "");
    if (!name) continue;
    deps.push(
      createSbomComponent({
        name,
        version: info.version,
        ecosystem: "npm",
        isDev: Boolean(info.dev || info.devOptional),
        isDirect: directNames.has(name),
        lockfilePath: path
      })
    );
  }
  return deps;
}
function parseYarnLock(path, content) {
  const deps = [];
  const seen = /* @__PURE__ */ new Set();
  const isBerry = content.includes("__metadata:");
  if (isBerry) {
    const blockRe = /^"(@?[^@\n]+)@npm:[^"]*":\s*$/gm;
    let blockMatch;
    while (blockMatch = blockRe.exec(content)) {
      const name = blockMatch[1]?.trim();
      if (!name || name === "__metadata") continue;
      const after = content.slice(
        blockMatch.index + blockMatch[0].length,
        blockMatch.index + blockMatch[0].length + 200
      );
      const verMatch = after.match(/^\s+version:\s+"?([^"\n\s]+)"?\s*$/m);
      if (!verMatch) continue;
      const key = `${name}@${verMatch[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push(
        createSbomComponent({
          name,
          version: verMatch[1],
          ecosystem: "npm",
          lockfilePath: path
        })
      );
    }
  } else {
    const blockRe = /^"?(@?[^@\s][^@\n]*?)@[^:\n]+"?(?:,\s*"?@?[^@\s][^@\n]*?@[^:\n]+"?)*:\s*$/gm;
    const versionRe = /^\s+version\s+"([^"]+)"/gm;
    let blockMatch;
    while (blockMatch = blockRe.exec(content)) {
      const rawNames = blockMatch[0].replace(/:$/, "");
      const nameMatch = rawNames.match(/^"?(@?[^@\s]+)/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      versionRe.lastIndex = blockMatch.index;
      const verMatch = versionRe.exec(content);
      if (!verMatch || verMatch.index - blockMatch.index >= 500) continue;
      const key = `${name}@${verMatch[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push(
        createSbomComponent({
          name,
          version: verMatch[1],
          ecosystem: "npm",
          lockfilePath: path
        })
      );
    }
  }
  return deps;
}
function parsePnpmLock(path, content) {
  const deps = [];
  const seen = /* @__PURE__ */ new Set();
  const patterns = [
    /^\s+\/?(@?[^@\s:][^@:]*?)@(\d[^:\s]*)\s*:/gm,
    /^\s+'(@?[^@'\s]+)@(\d[^']*)':\s*$/gm
  ];
  for (const pattern of patterns) {
    let match;
    while (match = pattern.exec(content)) {
      const name = match[1]?.replace(/^\//, "");
      const version2 = match[2];
      if (!name || !version2) continue;
      const key = `${name}@${version2}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push(
        createSbomComponent({
          name,
          version: version2,
          ecosystem: "npm",
          lockfilePath: path
        })
      );
    }
  }
  return deps;
}
function parsePoetryLock(path, content) {
  const blocks = content.split(/^\[\[package\]\]\s*$/m).slice(1);
  const deps = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
    const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
    const categoryMatch = block.match(/^category\s*=\s*"([^"]+)"/m);
    if (!nameMatch || !versionMatch) continue;
    deps.push(
      createSbomComponent({
        name: nameMatch[1],
        version: versionMatch[1],
        ecosystem: "pypi",
        isDev: categoryMatch?.[1] === "dev",
        lockfilePath: path
      })
    );
  }
  return deps;
}
function parseCargoLock(path, content) {
  const blocks = content.split(/^\[\[package\]\]\s*$/m).slice(1);
  const deps = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
    const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
    if (!nameMatch || !versionMatch) continue;
    deps.push(
      createSbomComponent({
        name: nameMatch[1],
        version: versionMatch[1],
        ecosystem: "crates",
        lockfilePath: path
      })
    );
  }
  return deps;
}
function parseGoSum(path, content) {
  const deps = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [mod, rawVersion] = parts;
    const version2 = rawVersion.replace(/\/go\.mod$/, "");
    const key = `${mod}@${version2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deps.push(
      createSbomComponent({
        name: mod,
        version: version2,
        ecosystem: "go",
        lockfilePath: path
      })
    );
  }
  return deps;
}
function parsePackageJson(path, content) {
  const manifest = JSON.parse(content);
  const deps = [];
  for (const [name, versionRange] of Object.entries(manifest.dependencies ?? {})) {
    deps.push(
      createSbomComponent({
        name,
        version: normalizeManifestVersion(versionRange),
        ecosystem: "npm",
        isDirect: true,
        lockfilePath: path
      })
    );
  }
  for (const [name, versionRange] of Object.entries(manifest.devDependencies ?? {})) {
    deps.push(
      createSbomComponent({
        name,
        version: normalizeManifestVersion(versionRange),
        ecosystem: "npm",
        isDev: true,
        isDirect: true,
        lockfilePath: path
      })
    );
  }
  for (const [name, versionRange] of Object.entries(manifest.optionalDependencies ?? {})) {
    deps.push(
      createSbomComponent({
        name,
        version: normalizeManifestVersion(versionRange),
        ecosystem: "npm",
        isDirect: true,
        lockfilePath: path
      })
    );
  }
  return deps;
}
function normalizeManifestVersion(versionRange) {
  const cleaned = versionRange.replace(/^[\^~>=<\s]+/, "").split(",")[0]?.trim();
  return cleaned || "unknown";
}
var LOCKFILE_PARSERS = {
  "package-lock.json": parsePackageLockJson,
  "yarn.lock": parseYarnLock,
  "pnpm-lock.yaml": parsePnpmLock,
  "poetry.lock": parsePoetryLock,
  "Cargo.lock": parseCargoLock,
  "go.sum": parseGoSum,
  "package.json": parsePackageJson
};
function parseLockfile(path, content) {
  const fileName = basename(path);
  const parser = LOCKFILE_PARSERS[fileName];
  if (!parser) return [];
  try {
    return parser(path, content);
  } catch {
    return [];
  }
}
function discoverComponentsFromFiles(files, options = {}) {
  const includeDev = options.includeDev ?? true;
  const byPath = new Map(files.map((file2) => [file2.path, file2.content]));
  let components = [];
  const lockfiles = [];
  const discoveredEcosystems = /* @__PURE__ */ new Set();
  const lockfileNames = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "Cargo.lock",
    "go.sum"
  ];
  for (const file2 of files) {
    const name = basename(file2.path);
    if (!lockfileNames.includes(name)) continue;
    const parsed = parseLockfile(file2.path, file2.content);
    if (parsed.length === 0) continue;
    lockfiles.push(file2.path);
    for (const component of parsed) {
      discoveredEcosystems.add(component.ecosystem);
    }
    components.push(...parsed);
  }
  if (components.length === 0) {
    for (const file2 of files) {
      if (basename(file2.path) !== "package.json") continue;
      const parsed = parseLockfile(file2.path, file2.content);
      if (parsed.length > 0) {
        lockfiles.push(file2.path);
        for (const component of parsed) {
          discoveredEcosystems.add(component.ecosystem);
        }
        components.push(...parsed);
      }
    }
  } else {
    const existing = new Set(components.map((component) => `${component.ecosystem}:${component.name}`));
    for (const file2 of files) {
      if (basename(file2.path) !== "package.json") continue;
      const parsed = parseLockfile(file2.path, file2.content);
      for (const component of parsed) {
        const key = `${component.ecosystem}:${component.name}`;
        if (!existing.has(key)) {
          components.push(component);
          existing.add(key);
        }
      }
    }
  }
  if (!includeDev) {
    components = components.filter((component) => !component.isDev);
  }
  return dedupeComponents(components);
}
function buildSbomSnapshot(files, options = {}) {
  const components = discoverComponentsFromFiles(files, options);
  const pkg = files.find((file2) => basename(file2.path) === "package.json");
  let projectName = "unknown";
  let projectVersion = "0.0.0";
  if (pkg) {
    try {
      const manifest = JSON.parse(pkg.content);
      projectName = manifest.name ?? projectName;
      projectVersion = manifest.version ?? projectVersion;
    } catch {
    }
  }
  const lockfiles = [
    ...new Set(
      components.map((component) => component.lockfilePath).filter((value) => Boolean(value))
    )
  ];
  return {
    components,
    metadata: {
      name: projectName,
      version: projectVersion,
      ecosystems: [...new Set(components.map((component) => component.ecosystem))],
      total: components.length,
      direct: components.filter((component) => component.isDirect).length,
      dev: components.filter((component) => component.isDev).length,
      lockfiles
    }
  };
}
function findLineNumber(content, needle) {
  const index = content.indexOf(needle);
  if (index < 0) return 1;
  return content.slice(0, index).split("\n").length;
}
function getFileContent(files, path) {
  if (!path) return null;
  return files.find((file2) => file2.path === path)?.content ?? null;
}

// features/security-analysis/osv/severity.ts
function scoreToSeverityLevel(score) {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}
function levelToScore(level) {
  switch (level.toLowerCase()) {
    case "critical":
      return 9.5;
    case "high":
      return 7.5;
    case "medium":
    case "moderate":
      return 5;
    case "low":
      return 2.5;
    default:
      return 0;
  }
}
function externalSeverityFromOsv(level) {
  switch (level) {
    case "critical":
      return "CRITICAL";
    case "high":
      return "HIGH";
    case "medium":
      return "MEDIUM";
    case "low":
      return "LOW";
    default:
      return "INFO";
  }
}
function severityRankFromOsv(level) {
  switch (level) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

// features/security-analysis/osv/map-vulnerability.ts
var OSV_ECOSYSTEM_MAP = {
  npm: "npm",
  pypi: "PyPI",
  rubygems: "RubyGems",
  crates: "crates.io",
  go: "Go",
  java: "Maven"
};
function parseCvssScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number.parseFloat(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}
function extractSeverity(entry) {
  for (const severity of entry.severity ?? []) {
    if (severity.type === "CVSS_V3" || severity.type === "CVSS_V4") {
      const score = parseCvssScore(severity.score);
      if (score != null) {
        return { level: scoreToSeverityLevel(score), score, method: severity.type };
      }
    }
  }
  const dbSeverity = entry.database_specific?.severity;
  if (dbSeverity) {
    const level = scoreToSeverityLevel(levelToScore(dbSeverity));
    return { level, score: levelToScore(dbSeverity), method: "database_specific" };
  }
  return { level: "unknown", score: null, method: null };
}
function formatAffectedRange(entry, pkg) {
  for (const affected of entry.affected ?? []) {
    if (affected.package?.name && affected.package.name !== pkg.name) {
      continue;
    }
    for (const range of affected.ranges ?? []) {
      const events = range.events ?? [];
      const introduced = events.find((event) => event.introduced)?.introduced ?? null;
      const fixed = events.find((event) => event.fixed)?.fixed ?? null;
      const lastAffected = events.find((event) => event.last_affected)?.last_affected ?? null;
      if (introduced || fixed || lastAffected) {
        const affectedVersionRange = introduced ? fixed ? `${introduced} \u2013 ${fixed}` : lastAffected ? `${introduced} \u2013 ${lastAffected}` : `${introduced}+` : fixed ? `< ${fixed}` : null;
        return { affectedVersionRange, fixedVersion: fixed ?? null };
      }
    }
  }
  return { affectedVersionRange: null, fixedVersion: null };
}
function mapOsvVulnerability(entry, pkg) {
  if (!entry.id) return null;
  const aliases = entry.aliases ?? [];
  const advisoryId = aliases.find((alias) => alias.startsWith("CVE-")) ?? entry.id;
  const severity = extractSeverity(entry);
  const range = formatAffectedRange(entry, pkg);
  return {
    osvId: entry.id,
    advisoryId,
    aliases,
    description: entry.summary ?? entry.details ?? "",
    severity: severity.level,
    cvssScore: severity.score,
    cvssMethod: severity.method,
    affectedVersionRange: range.affectedVersionRange,
    fixedVersion: range.fixedVersion,
    sourceUrl: `https://osv.dev/vulnerability/${entry.id}`
  };
}
function osvPackageNameForQuery(pkg) {
  if (pkg.ecosystem === "java" && pkg.namespace) {
    return `${pkg.namespace}:${pkg.name}`;
  }
  return pkg.name;
}
function osvEcosystemForQuery(ecosystem) {
  return OSV_ECOSYSTEM_MAP[ecosystem] ?? ecosystem;
}
function toOsvQueryPackage(component) {
  if (!component.version || component.version === "unknown") {
    return null;
  }
  return {
    name: component.name,
    version: component.version,
    ecosystem: component.ecosystem,
    namespace: component.namespace,
    purl: component.purl
  };
}
function cacheKeyForPackage(pkg) {
  return packageIdentity(pkg);
}
function mapOsvConfidence(vuln) {
  if (vuln.advisoryId.startsWith("CVE-") && vuln.cvssScore != null && vuln.cvssScore >= 7) {
    return "HIGH";
  }
  if (vuln.advisoryId.startsWith("CVE-") || vuln.cvssScore != null) {
    return "MEDIUM";
  }
  return "LOW";
}
function mapOsvExternalSeverity(vuln) {
  return {
    severity: externalSeverityFromOsv(vuln.severity),
    severityRank: severityRankFromOsv(vuln.severity)
  };
}

// features/security-analysis/osv/types.ts
var OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";
var OSV_BATCH_SIZE = 1e3;
var OSV_FETCH_TIMEOUT_MS = 3e4;
var OsvQueryError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "OsvQueryError";
  }
};

// features/security-analysis/osv/client.ts
function isQueryPackage(value) {
  return value != null;
}
async function fetchWithRetry(url2, init, fetchImpl, timeoutMs, retries = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url2, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    if (response.status === 429 && retries > 0) {
      await new Promise((resolve2) => setTimeout(resolve2, 2e3));
      return fetchWithRetry(url2, init, fetchImpl, timeoutMs, retries - 1);
    }
    return response;
  } catch (error51) {
    clearTimeout(timeout);
    if (retries > 0) {
      await new Promise((resolve2) => setTimeout(resolve2, 1e3));
      return fetchWithRetry(url2, init, fetchImpl, timeoutMs, retries - 1);
    }
    if (error51 instanceof Error && error51.name === "AbortError") {
      throw new OsvQueryError("OSV request timed out", "timeout");
    }
    throw new OsvQueryError(
      error51 instanceof Error ? error51.message : "OSV network request failed",
      "network_error"
    );
  }
}
function parseBatchResponse(body) {
  if (!body || typeof body !== "object" || !("results" in body)) {
    throw new OsvQueryError("Malformed OSV batch response", "malformed_response");
  }
  const results = body.results;
  if (!Array.isArray(results)) {
    throw new OsvQueryError("Malformed OSV batch response", "malformed_response");
  }
  return results.map((entry) => {
    if (!entry || typeof entry !== "object" || !("vulns" in entry)) return [];
    const vulns = entry.vulns;
    return Array.isArray(vulns) ? vulns : [];
  });
}
async function queryOsvBatch(packages, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? OSV_FETCH_TIMEOUT_MS;
  const results = /* @__PURE__ */ new Map();
  const memoryCache = options.cache;
  const uncached = [];
  for (const pkg of packages) {
    const key = cacheKeyForPackage(pkg);
    const cached2 = memoryCache?.get(key);
    if (cached2) {
      const mapped = cached2.map((entry) => mapOsvVulnerability(entry, pkg)).filter((entry) => entry != null);
      if (mapped.length > 0) results.set(key, mapped);
      continue;
    }
    uncached.push(pkg);
  }
  for (let index = 0; index < uncached.length; index += OSV_BATCH_SIZE) {
    const chunk = uncached.slice(index, index + OSV_BATCH_SIZE);
    const queries = chunk.map((pkg) => ({
      package: {
        name: osvPackageNameForQuery(pkg),
        ecosystem: osvEcosystemForQuery(pkg.ecosystem)
      },
      version: pkg.version
    }));
    try {
      const response = await fetchWithRetry(
        OSV_BATCH_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries })
        },
        fetchImpl,
        timeoutMs
      );
      if (!response.ok) {
        if (response.status === 429) {
          throw new OsvQueryError("OSV rate limited", "rate_limited");
        }
        throw new OsvQueryError(`OSV unavailable (${response.status})`, "unavailable");
      }
      const body = await response.json();
      const batchResults = parseBatchResponse(body);
      for (let i = 0; i < chunk.length; i += 1) {
        const pkg = chunk[i];
        const key = cacheKeyForPackage(pkg);
        const rawVulns = batchResults[i] ?? [];
        memoryCache?.set(key, rawVulns);
        const mapped = rawVulns.map((entry) => mapOsvVulnerability(entry, pkg)).filter((entry) => entry != null);
        if (mapped.length > 0) results.set(key, mapped);
      }
    } catch (error51) {
      if (error51 instanceof OsvQueryError) {
        throw error51;
      }
      throw new OsvQueryError(
        error51 instanceof Error ? error51.message : "OSV query failed",
        "network_error"
      );
    }
  }
  return results;
}
function componentsToOsvPackages(components) {
  return components.map(toOsvQueryPackage).filter(isQueryPackage);
}
function createOsvMemoryCache() {
  return /* @__PURE__ */ new Map();
}

// features/security-analysis/package-security/constants.ts
var PACKAGE_SECURITY_RULE_ID = "package-security.scan-packages";
var PACKAGE_SECURITY_SOURCE_TOOL = "scan_packages";
var REGISTRY_TIMEOUT_MS = 8e3;
var REGISTRY_LOOKUP_CONCURRENCY = 8;
var REGISTRY_SUPPORTED_ECOSYSTEMS = /* @__PURE__ */ new Set([
  "npm",
  "pypi",
  "crates",
  "rubygems",
  "go"
]);
var PACKAGE_SECURITY_CATEGORY_REMEDIATION = {
  "package-hallucination": "Verify this dependency exists in the public registry before installing it. AI-generated package names are often incorrect or hallucinated.",
  "package-typosquat": "Confirm the intended package name. Similar-looking packages may be typosquats designed to trick dependency resolution.",
  "dependency-confusion": "Ensure internal or scoped package names cannot be satisfied by an unexpected public package with the same unscoped name.",
  "ecosystem-mismatch": "Review whether this dependency belongs in the detected repository ecosystem or was generated for the wrong package manager."
};
var NPM_BUILTIN_PACKAGES = /* @__PURE__ */ new Set([
  "node",
  "fs",
  "path",
  "http",
  "https",
  "crypto",
  "util",
  "stream",
  "events",
  "buffer",
  "os",
  "child_process",
  "assert",
  "url",
  "querystring",
  "zlib",
  "net",
  "tls",
  "dns",
  "readline",
  "cluster",
  "worker_threads",
  "perf_hooks",
  "v8",
  "vm",
  "module",
  "process"
]);

// features/security-analysis/package-security/registry-client.ts
function cacheKey(ecosystem, name) {
  return `${ecosystem}:${name.toLowerCase()}`;
}
function encodeNpmPackage(name) {
  return name.startsWith("@") ? name.replace("/", "%2F") : name;
}
function registryUrl(ecosystem, name) {
  switch (ecosystem) {
    case "npm":
      return `https://registry.npmjs.org/${encodeNpmPackage(name)}`;
    case "pypi":
      return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
    case "crates":
      return `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
    case "rubygems":
      return `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`;
    case "go":
      return `https://proxy.golang.org/${encodeURIComponent(name)}/@v/list`;
    default:
      return "";
  }
}
async function fetchWithTimeout(url2, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url2, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
async function lookupSingle(ecosystem, name, options) {
  const url2 = registryUrl(ecosystem, name);
  if (!url2) {
    return { status: "skipped", reason: "unsupported_ecosystem" };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REGISTRY_TIMEOUT_MS;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url2, fetchImpl, timeoutMs);
      if (response.status === 404) {
        return { status: "not_found", registryUrl: url2 };
      }
      if (!response.ok) {
        return { status: "unavailable", reason: `registry_status_${response.status}`, registryUrl: url2 };
      }
      if (ecosystem === "go") {
        const text = await response.text();
        if (!text.trim()) {
          return { status: "not_found", registryUrl: url2 };
        }
        return { status: "exists", registryUrl: url2 };
      }
      const body = await response.json().catch(() => null);
      if (!body || typeof body !== "object") {
        return { status: "unavailable", reason: "malformed_response", registryUrl: url2 };
      }
      return { status: "exists", registryUrl: url2 };
    } catch (error51) {
      const reason = error51 instanceof Error && error51.name === "AbortError" ? "timeout" : "network_error";
      if (attempt === 0 && reason === "timeout") {
        continue;
      }
      return { status: "unavailable", reason, registryUrl: url2 };
    }
  }
  return { status: "unavailable", reason: "timeout", registryUrl: url2 };
}
async function lookupPackages(packages, options = {}) {
  const cache = options.cache ?? /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  const unique = /* @__PURE__ */ new Map();
  for (const pkg of packages) {
    unique.set(cacheKey(pkg.ecosystem, pkg.name), pkg);
  }
  const uncached = [];
  for (const [key, pkg] of unique) {
    const cached2 = cache.get(key);
    if (cached2) {
      results.set(key, cached2);
      continue;
    }
    uncached.push({ key, pkg });
  }
  for (let index = 0; index < uncached.length; index += REGISTRY_LOOKUP_CONCURRENCY) {
    const chunk = uncached.slice(index, index + REGISTRY_LOOKUP_CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ key, pkg }) => {
        const result = await lookupSingle(pkg.ecosystem, pkg.name, options);
        cache.set(key, result);
        results.set(key, result);
      })
    );
  }
  return results;
}
function createRegistryCache() {
  return /* @__PURE__ */ new Map();
}

// features/security-analysis/shared/scan-context.ts
function toRepositoryFiles(files) {
  return files.map((file2) => ({ path: file2.path, content: file2.content }));
}
function createScanSharedContext(files, options = {}) {
  const repositoryFiles = toRepositoryFiles(files);
  return {
    repositoryFiles,
    sbomSnapshot: buildSbomSnapshot(repositoryFiles, { includeDev: options.includeDev ?? true }),
    registryCache: createRegistryCache(),
    osvCache: createOsvMemoryCache()
  };
}

// features/security-scanner/path.ts
function sanitizePath(input) {
  if (!input || input.includes("\0") || input.startsWith("/") || /^[A-Za-z]:[\\/]/.test(input)) {
    return null;
  }
  const normalized = input.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
  const parts = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/") || null;
}
function extensionOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name.startsWith(".env")) return ".env";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

// features/security-scanner/normalization.ts
function looksBinary(content) {
  return content.includes("\0");
}
function priorityOf(path) {
  const lower = path.toLowerCase();
  if (/(?:auth|middleware|session|jwt|rbac|permission)/.test(lower)) return 1;
  if (lower.includes("api/") || lower.includes("routes/")) return 2;
  if (lower.includes("config") || lower.endsWith(".env.example") || lower.includes("vercel.json")) {
    return 3;
  }
  if (lower.includes("__tests__") || lower.includes("tests/") || lower.includes("fixtures/") || /\.(?:test|spec)\./.test(lower)) {
    return 5;
  }
  if (lower.includes("lib/") || lower.includes("features/") || lower.includes("components/")) {
    return 4;
  }
  return 6;
}
function byPriority(a, b) {
  const priorityDiff = priorityOf(a.path) - priorityOf(b.path);
  return priorityDiff !== 0 ? priorityDiff : a.path.localeCompare(b.path);
}
function normalizeFiles(files, config2) {
  const normalized = [];
  const omissions = [];
  let bytes = 0;
  let truncated = false;
  for (const input of [...files].sort(byPriority)) {
    const path = sanitizePath(input.path);
    if (!path) {
      omissions.push({ path: input.path, reason: "invalid-path" });
      continue;
    }
    const segments = path.split("/");
    if (segments.some((segment) => config2.ignoredSegments.includes(segment)) || path.startsWith("public/assets/") || path.endsWith(".map") || /\.min\.(?:js|css)$/i.test(path) || /\.generated\.[^.]+$/i.test(path)) {
      omissions.push({ path, reason: "ignored" });
      continue;
    }
    const extension2 = extensionOf(path);
    if (extension2 === ".md" && !/(?:^|\/)(?:readme|security|auth|configuration|config|deployment|environment)[^/]*\.md$/i.test(path)) {
      omissions.push({ path, reason: "ignored" });
      continue;
    }
    if (DEFAULT_BINARY_EXTENSIONS.has(extension2) || looksBinary(input.content) || config2.includeExtensions && !config2.includeExtensions.includes(extension2) && !path.endsWith(".env.example") && !/(?:^|\/)Dockerfile$/i.test(path)) {
      omissions.push({ path, reason: "binary" });
      continue;
    }
    const size = new TextEncoder().encode(input.content).byteLength;
    if (size > config2.maxFileBytes) {
      omissions.push({ path, reason: "file-too-large" });
      continue;
    }
    if (normalized.length >= config2.maxFiles || bytes + size > config2.maxTotalBytes) {
      omissions.push({ path, reason: "total-limit" });
      truncated = true;
      continue;
    }
    const content = input.content.replace(/\r\n?/g, "\n");
    normalized.push({ path, content, lines: content.split("\n"), extension: extension2, bytes: size });
    bytes += size;
  }
  return { files: normalized, omissions, bytes, truncated };
}
function stubNormalizedFile(path, content = "") {
  const normalized = content.replace(/\r\n?/g, "\n");
  return {
    path,
    content: normalized,
    extension: extensionOf(path),
    lines: normalized.length > 0 ? normalized.split("\n") : [],
    bytes: new TextEncoder().encode(normalized).byteLength
  };
}

// features/security-scanner/redaction.ts
var VALUE_ASSIGNMENT = /((?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["']?)([^"'\s,;]{4,})/gi;
var KNOWN_TOKEN = /\b(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[oprsu]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
function maskSecret(value) {
  if (value.length <= 6) return "[REDACTED]";
  return `${value.slice(0, 3)}\u2026${value.slice(-2)}`;
}
function redactEvidence(value, maxLength = 240) {
  const redacted = value.replace(VALUE_ASSIGNMENT, (_, prefix, secret) => `${prefix}${maskSecret(secret)}`).replace(KNOWN_TOKEN, (secret) => maskSecret(secret));
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}\u2026` : redacted;
}

// features/security-scanner/rules/helpers.ts
function patternFindings(ruleId, files, specs) {
  const findings = [];
  for (const file2 of files) {
    for (let index = 0; index < file2.lines.length; index += 1) {
      const line = file2.lines[index];
      for (const spec of specs) {
        if (spec.path && !spec.path.test(file2.path)) continue;
        if (spec.excludePath?.test(file2.path)) continue;
        spec.pattern.lastIndex = 0;
        const match = spec.pattern.exec(line);
        if (!match) continue;
        findings.push({
          ruleId,
          title: spec.title,
          description: spec.description,
          severity: spec.severity,
          confidence: spec.confidence,
          category: spec.category,
          location: { path: file2.path, line: index + 1, column: match.index + 1 },
          evidence: redactEvidence(line.trim()),
          remediation: spec.remediation,
          fingerprintMaterial: match[0].replace(/\s+/g, " ")
        });
      }
    }
  }
  return findings;
}

// features/security-scanner/rules/client-exposure.ts
var USE_CLIENT_DIRECTIVE = /^\s*["']use client["'];?/m;
var SERVER_ONLY_IMPORT = /import\s+["']server-only["']/;
var NEXT_API_ROUTE = /(?:^|\/)app\/api\/.*\/route\.[jt]sx?$/i;
var SERVER_DIRECTORY = /(?:^|\/)server\//;
var NODEJS_RUNTIME = /export\s+const\s+runtime\s*=\s*["']nodejs["']/;
var SERVICE_ROLE_REFERENCE = /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i;
function referencesSupabaseServiceRole(file2) {
  return SERVICE_ROLE_REFERENCE.test(file2.content);
}
function isExplicitlyServerModule(file2) {
  if (SERVER_ONLY_IMPORT.test(file2.content)) return true;
  if (NEXT_API_ROUTE.test(file2.path)) return true;
  if (SERVER_DIRECTORY.test(file2.path)) return true;
  if (NODEJS_RUNTIME.test(file2.content)) return true;
  return false;
}
function isClientExecutedModule(file2) {
  return USE_CLIENT_DIRECTIVE.test(file2.content);
}
function isSupabaseServiceRoleClientExposure(file2) {
  if (!referencesSupabaseServiceRole(file2)) return false;
  if (isExplicitlyServerModule(file2)) return false;
  return isClientExecutedModule(file2);
}
function firstServiceRoleReferenceLine(file2) {
  const index = file2.lines.findIndex((line) => SERVICE_ROLE_REFERENCE.test(line));
  return index >= 0 ? index + 1 : 1;
}
var SUPABASE_CONFIG_PATH = /(?:^|\/)supabase\/config\.toml$/i;
var POSTGREST_EXPOSURE_SIGNAL = /NEXT_PUBLIC_SUPABASE_(?:URL|ANON_KEY)|SUPABASE_ANON_KEY|@supabase\/supabase-js|postgrest|SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i;
function repoExposesPostgresToClients(files) {
  return files.some((file2) => SUPABASE_CONFIG_PATH.test(file2.path) || POSTGREST_EXPOSURE_SIGNAL.test(file2.content));
}

// features/security-scanner/rules/known-safe-patterns.ts
var RECOGNIZED_AUTH_PATTERN = /(?:auth\(|getServerSession|getServerAuthContext|getCachedServerAuthContext|getScanRequestContext|getScanAccessContext|resolveMcpAuth|assertInternalOpsAuthorized|verifyInternalOpsRequest|serve\s*\(|signingKey|verifyGitHubWebhookSignature|verifyStripeWebhookSignature|constructEvent|webhookSecret|exchangeCodeForSession|currentUser|getUser|verifyToken|requireAuth|Authorization|supabase\.auth\.getUser|requireCiProjectAccess|requireProjectApiAccess|code_verifier|codeVerifier|assertActiveOAuthClient)/i;
var RECOGNIZED_AUTHZ_PATTERN = /(?:authorize|permission|role|ownerId|organizationId|organization_id|userId\s*[=!]==?|can\w+\(|policy|getServerAuthContext|getCachedServerAuthContext|getScanRequestContext|getScanAccessContext|resolveMcpAuth|assertInternalOpsAuthorized|verifyInternalOpsRequest|requireProjectApiAccess|getProjectAccessForUser|canAccessRepository|verifyGitHubWebhookSignature|verifyStripeWebhookSignature|constructEvent|requireCiProjectAccess)/i;
var TEST_OR_EXAMPLE_PATH = /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\./i;
var MACHINE_ENDPOINT_PATH = /\/oauth\/(?:register|revoke|token)(?:\/|$)|\/\.well-known\/|\/auth\/callback\/|\/webhooks?\/|\/api\/internal\//i;

// features/security-scanner/rules/builtin.ts
var TEST_OR_EXAMPLE2 = /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\./i;
var ROUTE_PATH = /(?:^|\/)(?:api|routes?|controllers?|handlers?)(?:\/|$)|route\.[jt]s$/i;
var CODE_PATH = /\.(?:[cm]?[jt]sx?|py|rb|go|java|php)$/i;
var MOCK_OR_TEST_PATH = new RegExp(
  `${TEST_OR_EXAMPLE2.source}|(?:^|\\/)mock-|mock-api-runtime`,
  "i"
);
function patternRule(id, title, specs) {
  return { id, title, run: ({ files }) => patternFindings(id, files, specs) };
}
var EXAMPLE_ENV_FILE = /(?:^|\/)\.env\.(?:example|sample)(?:\.|$)/i;
var README_FILE = /(?:^|\/)README(?:\.md)?$/i;
var PLACEHOLDER_VALUE2 = /(?:example|sample|placeholder|your[_-]|change[_-]?me|xxx|test[_-]?key|process\.env|\$\{|generate-a|long-random|seq_live_\.\.\.|\.\.\.|not-a-real|replace-me|insert[-_]|fake[-_]|dummy)/i;
function buildSecretFinding(input) {
  const classification = classifySecretDetection({
    path: input.file.path,
    value: input.value,
    variableName: input.variableName,
    line: input.file.lines[input.lineIndex],
    lineIndex: input.lineIndex,
    fileLines: input.file.lines
  });
  const severity = input.patternSeverity ?? (classification.classification === "REAL_SECRET" && /PRIVATE KEY/.test(input.value) ? "critical" : severityForSecretClassification(classification.classification));
  const confidence = confidenceForSecretClassification(
    classification.classification,
    classification.confidence
  );
  return {
    ruleId: "secrets.exposed",
    title: "Hard-coded secret",
    description: classification.classification === "TEST_FIXTURE" ? "A test-like credential value appears in source code." : classification.classification === "PLACEHOLDER" ? "A placeholder credential-like value appears in source code." : "A credential-like value is committed in source.",
    severity,
    confidence,
    category: "secrets",
    location: { path: input.file.path, line: input.lineIndex + 1 },
    evidence: input.evidence,
    remediation: classification.classification === "TEST_FIXTURE" || classification.classification === "PLACEHOLDER" ? "Confirm this is only a test fixture or placeholder and not a real credential." : "Revoke the credential, remove it from history, and load it from a secret manager.",
    fingerprintMaterial: input.fingerprintMaterial,
    metadata: {
      [SECRET_CLASSIFICATION_METADATA_KEY]: classification.classification,
      secretClassificationSignals: classification.signals
    }
  };
}
var exposedSecrets = {
  id: "secrets.exposed",
  title: "Exposed secrets",
  run: ({ files }) => {
    const findings = [];
    for (const file2 of files) {
      if (EXAMPLE_ENV_FILE.test(file2.path) || README_FILE.test(file2.path)) continue;
      for (let i = 0; i < file2.lines.length; i += 1) {
        const line = file2.lines[i];
        const token = REAL_CREDENTIAL_PATTERNS.map((pattern) => line.match(pattern)).find(Boolean);
        if (token) {
          if (PLACEHOLDER_VALUE2.test(token[0])) continue;
          findings.push(
            buildSecretFinding({
              file: file2,
              lineIndex: i,
              value: token[0],
              evidence: "credential=[REDACTED]",
              fingerprintMaterial: token[0].slice(0, 8),
              patternSeverity: token[0].startsWith("sk_live_") || /PRIVATE KEY/.test(token[0]) ? "critical" : "high"
            })
          );
          continue;
        }
        const quotedAssignment = line.match(
          /^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?["']?([A-Z0-9_-]{3,})["']?\s*[:=]\s*["']([^"']{8,})["']/i
        );
        const envAssignment = line.match(/^\s*([A-Z0-9_]{3,})\s*=\s*(\S+)/);
        const assignment = quotedAssignment ?? envAssignment;
        if (!assignment || !SECRET_NAME_PATTERN.test(assignment[1])) continue;
        if (quotedAssignment && !/^\s*(?:export\s+)?(?:const|let|var)\s+/i.test(line) && /^\s*[A-Za-z_][\w]*\s*:\s/.test(line)) {
          continue;
        }
        const value = assignment[2];
        const classification = classifySecretDetection({
          path: file2.path,
          value,
          variableName: assignment[1],
          line,
          lineIndex: i,
          fileLines: file2.lines
        });
        if (classification.classification === "FALSE_POSITIVE") continue;
        findings.push(
          buildSecretFinding({
            file: file2,
            lineIndex: i,
            value,
            variableName: assignment[1],
            evidence: `${assignment[1]}=[REDACTED]`,
            fingerprintMaterial: assignment[1]
          })
        );
      }
    }
    return findings;
  }
};
var publicEnvSecrets = {
  id: "secrets.public-env",
  title: "Secrets exposed to clients",
  run: ({ files }) => {
    const findings = [];
    for (const file2 of files) {
      for (let i = 0; i < file2.lines.length; i += 1) {
        const match = file2.lines[i].match(/\b((?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_)[A-Z0-9_]+)\b\s*[:=]/);
        if (!match || !CLIENT_ENV_PREFIX_PATTERN.test(match[1]) || !SECRET_NAME_PATTERN.test(match[1])) continue;
        findings.push({
          ruleId: "secrets.public-env",
          title: "Secret uses a public environment prefix",
          description: "Client-prefixed environment variables are bundled into browser code.",
          severity: "high",
          confidence: "high",
          category: "secrets",
          location: { path: file2.path, line: i + 1 },
          evidence: `${match[1]}=[REDACTED]`,
          remediation: "Keep the credential server-only and expose a narrowly scoped server endpoint.",
          fingerprintMaterial: match[1]
        });
      }
    }
    return findings;
  }
};
var serviceRoleInClient = {
  id: "supabase.service-role-client",
  title: "Supabase service role exposed to client code",
  run: ({ files }) => files.filter(isSupabaseServiceRoleClientExposure).map((file2) => ({
    ruleId: "supabase.service-role-client",
    title: "Supabase service role referenced in client code",
    description: "A service-role credential bypasses RLS and must never be bundled for browsers.",
    severity: "critical",
    confidence: "high",
    category: "secrets",
    location: {
      path: file2.path,
      line: firstServiceRoleReferenceLine(file2)
    },
    evidence: "SUPABASE_SERVICE_ROLE_KEY=[REDACTED]",
    remediation: "Remove the service-role key from client code, rotate it, and use it only in a protected server environment.",
    fingerprintMaterial: "supabase-service-role-client"
  }))
};
var injectionRules = [
  patternRule("injection.sql", "SQL injection", [{
    pattern: /\b(?:query|execute|raw)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+|f["'][^"']*\{)/i,
    title: "Dynamic SQL query construction",
    description: "Untrusted data may be interpolated into SQL.",
    severity: "high",
    confidence: "medium",
    category: "injection",
    remediation: "Use parameterized queries or the ORM query builder.",
    path: CODE_PATH
  }]),
  patternRule("injection.command", "Command injection", [{
    pattern: /\b(?:exec|execSync|system|popen|shell_exec)\s*\(\s*(?:`[^`]*\$\{|[^)]*(?:req\.|request\.|params|query|body))/i,
    title: "User-controlled command execution",
    description: "Input may be incorporated into an operating-system command.",
    severity: "critical",
    confidence: "medium",
    category: "injection",
    remediation: "Avoid shell execution; use an argument-array API and strict allowlists.",
    path: CODE_PATH
  }, {
    pattern: /\bspawn(?:Sync)?\s*\([^)]*(?:req\.|request\.|params|query|body)[\s\S]{0,160}shell\s*:\s*true/i,
    title: "User-controlled command executed through a shell",
    description: "A dynamic spawn call enables shell interpretation.",
    severity: "critical",
    confidence: "high",
    category: "injection",
    remediation: "Disable shell mode and pass validated arguments as a fixed array.",
    path: CODE_PATH
  }]),
  patternRule("injection.path-traversal", "Path traversal", [{
    pattern: /\b(?:readFile|readFileSync|writeFile|createReadStream|sendFile|open)\s*\([^)]*(?:req\.|request\.|params|query|body)/i,
    title: "User-controlled filesystem path",
    description: "A request value appears to flow into a filesystem operation.",
    severity: "high",
    confidence: "medium",
    category: "injection",
    remediation: "Resolve against a fixed base directory and reject paths that escape it.",
    path: CODE_PATH
  }])
];
var configurationRules = [
  patternRule("web.permissive-cors", "Permissive CORS", [{
    pattern: /(?:Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*|cors\s*\(\s*(?:\)|\{[^}]*origin\s*:\s*(?:true|["']\*)))/i,
    title: "Permissive cross-origin policy",
    description: "The application allows requests from any origin.",
    severity: "medium",
    confidence: "high",
    category: "configuration",
    remediation: "Allow only explicitly trusted origins and avoid credentialed wildcard policies.",
    path: CODE_PATH,
    excludePath: MOCK_OR_TEST_PATH
  }, {
    pattern: /origin\s*:\s*\([^)]*\)\s*=>\s*(?:true|callback\s*\(\s*null\s*,\s*true)/i,
    title: "CORS origin reflected without an allowlist",
    description: "The origin callback appears to approve every requesting origin.",
    severity: "high",
    confidence: "high",
    category: "configuration",
    remediation: "Compare the origin against an explicit allowlist before approving it.",
    path: CODE_PATH,
    excludePath: MOCK_OR_TEST_PATH
  }]),
  patternRule("auth.insecure-cookie", "Insecure cookies", [{
    pattern: /\.cookie\s*\([^)]*,[^)]*,\s*\{(?:(?!secure\s*:\s*true).)*\}/i,
    title: "Cookie lacks explicit secure attributes",
    description: "A cookie is created without an explicit secure flag.",
    severity: "medium",
    confidence: "medium",
    category: "authentication",
    remediation: "Set Secure, HttpOnly, and an appropriate SameSite policy.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE2
  }, {
    pattern: /(?:httpOnly|secure)\s*:\s*false/i,
    title: "Cookie security disabled",
    description: "A cookie security attribute is explicitly disabled.",
    severity: "high",
    confidence: "high",
    category: "authentication",
    remediation: "Enable Secure and HttpOnly for session cookies.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE2
  }, {
    pattern: /(?:cookies?\.set|setCookie)\s*\([^)]*,\s*\{(?:(?!httpOnly\s*:\s*true|sameSite\s*:).)*\}/i,
    title: "Session cookie lacks explicit browser protections",
    description: "A cookie configuration omits HttpOnly or SameSite protection.",
    severity: "medium",
    confidence: "medium",
    category: "authentication",
    remediation: "Set HttpOnly, Secure in production, SameSite, and a reasonable expiration.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE2
  }]),
  patternRule("auth.insecure-jwt", "Insecure JWT", [{
    pattern: /(?:algorithm|algorithms)\s*:\s*(?:["']none["']|\[\s*["']none["']\s*\])/i,
    title: "JWT accepts the none algorithm",
    description: "Unsigned JWTs may be accepted.",
    severity: "critical",
    confidence: "high",
    category: "authentication",
    remediation: "Require a specific asymmetric or HMAC algorithm and validate issuer and audience.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE2
  }, {
    pattern: /jwt\.decode\s*\(/i,
    title: "JWT decoded without visible verification",
    description: "Decoding alone does not verify a JWT signature.",
    severity: "high",
    confidence: "medium",
    category: "authentication",
    remediation: "Verify the token signature, algorithm, issuer, audience, and expiration.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE2
  }, {
    pattern: /jwt\.sign\s*\([^;\n]+(?:\)|\})\s*;?$/im,
    title: "JWT may be issued without explicit expiration",
    description: "A JWT signing call has no visible expiresIn option.",
    severity: "medium",
    confidence: "low",
    category: "authentication",
    remediation: "Set a short explicit expiration and validate issuer and audience when verifying.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE2
  }]),
  patternRule("privacy.sensitive-logging", "Sensitive logging and debug", [{
    pattern: /console\.(?:log|debug|info)\s*\([^)]*(?:password|secret|token|authorization|cookie|req\.body)/i,
    title: "Sensitive value may be logged",
    description: "Logs may expose credentials or request secrets.",
    severity: "medium",
    confidence: "medium",
    category: "privacy",
    remediation: "Remove the log or apply structured allowlist-based redaction.",
    path: CODE_PATH,
    excludePath: TEST_OR_EXAMPLE2
  }, {
    pattern: /\bdebug\s*[:=]\s*true\b/i,
    title: "Debug mode enabled",
    description: "Debug output can disclose implementation details.",
    severity: "low",
    confidence: "medium",
    category: "configuration",
    remediation: "Disable debug mode in production configuration.",
    excludePath: TEST_OR_EXAMPLE2
  }]),
  patternRule("web.open-redirect", "Open redirect", [{
    pattern: /(?:redirect|location(?:\.href)?\s*=)\s*\([^)]*(?:req\.|request\.|params|query|searchParams)/i,
    title: "User-controlled redirect",
    description: "A request value appears to determine the redirect destination.",
    severity: "medium",
    confidence: "medium",
    category: "web",
    remediation: "Allowlist local paths or trusted destination hosts.",
    path: CODE_PATH
  }]),
  patternRule("web.next-xss", "Next.js and XSS", [{
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!DOMPurify|sanitize)/,
    title: "Unsanitized HTML rendering",
    description: "React HTML injection can execute attacker-controlled markup.",
    severity: "high",
    confidence: "medium",
    category: "xss",
    remediation: "Avoid raw HTML or sanitize it with a maintained allowlist sanitizer.",
    path: /\.(?:jsx|tsx)$/
  }, {
    pattern: /\.innerHTML\s*=\s*(?!DOMPurify|sanitize|trustedTypes)/,
    title: "Unsanitized innerHTML assignment",
    description: "Direct HTML assignment may execute attacker-controlled markup.",
    severity: "high",
    confidence: "medium",
    category: "xss",
    remediation: "Render text safely or sanitize markup with a maintained allowlist sanitizer.",
    path: CODE_PATH
  }, {
    pattern: /\bNextResponse\.next\s*\(\s*\{\s*request\s*:\s*\{\s*headers/i,
    title: "Request headers forwarded broadly",
    description: "Forwarding an unrestricted header set can leak or trust spoofable values.",
    severity: "low",
    confidence: "low",
    category: "configuration",
    remediation: "Copy only explicitly required headers.",
    path: /(?:middleware|proxy)\.[jt]s$/
  }])
];
var missingNextSecurityHeaders = {
  id: "next.security-headers",
  title: "Missing Next.js security headers",
  run: ({ files }) => {
    const config2 = files.find((file2) => /^next\.config\.[cm]?[jt]s$/.test(file2.path));
    if (!config2 || !/\bheaders\s*\(/.test(config2.content)) return [];
    const missing = [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy"
    ].filter((header) => !config2.content.includes(header));
    if (missing.length === 0) return [];
    return [{
      ruleId: "next.security-headers",
      title: "Next.js security headers are incomplete",
      description: `The existing headers configuration does not visibly set: ${missing.join(", ")}.`,
      severity: "low",
      confidence: "high",
      category: "configuration",
      location: { path: config2.path, line: 1 },
      evidence: `Missing ${missing.join(", ")}`,
      remediation: "Add the missing headers with values appropriate for the deployed application.",
      fingerprintMaterial: missing.join(",")
    }];
  }
};
function contextualRouteRule(id, title, missing, finding, options) {
  return {
    id,
    title,
    run: ({ files }) => files.filter((file2) => ROUTE_PATH.test(file2.path) && CODE_PATH.test(file2.path) && /(?:export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)|\b(?:router|app)\.(?:get|post|put|patch|delete)\s*\()/i.test(file2.content)).filter((file2) => !options?.excludePath?.test(file2.path)).filter((file2) => !options?.excludeContent?.test(file2.content)).filter((file2) => !options?.includeContent || options.includeContent.test(file2.content)).filter((file2) => !missing.test(file2.content)).map((file2) => ({ ...finding, ruleId: id, location: { path: file2.path, line: 1 }, fingerprintMaterial: file2.path }))
  };
}
var RECOGNIZED_AUTH = RECOGNIZED_AUTH_PATTERN;
var RECOGNIZED_AUTHZ = RECOGNIZED_AUTHZ_PATTERN;
var DEPRECATED_PUBLIC_ROUTE = /const\s+deprecated\s*=[\s\S]*?status:\s*410/i;
var UNIMPLEMENTED_STUB_ROUTE = /not\s+yet\s+implemented/i;
var MUTATING_ROUTE_HANDLER = /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/i;
var ROUTE_RULE_EXCLUSIONS = {
  excludePath: MACHINE_ENDPOINT_PATH,
  excludeContent: new RegExp(
    `${DEPRECATED_PUBLIC_ROUTE.source}|${UNIMPLEMENTED_STUB_ROUTE.source}`,
    "i"
  )
};
var routeRules = [
  contextualRouteRule("auth.missing", "Missing authentication", RECOGNIZED_AUTH, {
    title: "Route has no visible authentication",
    description: "A request handler was found without a recognizable authentication check.",
    severity: "medium",
    confidence: "low",
    category: "authentication",
    remediation: "Enforce authentication in the handler or a guaranteed middleware layer."
  }, ROUTE_RULE_EXCLUSIONS),
  contextualRouteRule("authz.insufficient", "Insufficient authorization", RECOGNIZED_AUTHZ, {
    title: "Route has no visible authorization",
    description: "The handler has no recognizable ownership, role, or policy check.",
    severity: "medium",
    confidence: "low",
    category: "authorization",
    remediation: "Check object ownership or explicit permissions after authentication."
  }, ROUTE_RULE_EXCLUSIONS),
  contextualRouteRule("validation.missing", "Missing validation", /(?:\.parse\(|safeParse|validate|schema|joi\.|yup\.|zod|validator)/i, {
    title: "Route has no visible input validation",
    description: "A mutating handler lacks a recognizable schema validation step.",
    severity: "low",
    confidence: "low",
    category: "validation",
    remediation: "Validate request inputs with an explicit schema before use."
  }, {
    ...ROUTE_RULE_EXCLUSIONS,
    includeContent: MUTATING_ROUTE_HANDLER
  }),
  contextualRouteRule("rate-limit.missing", "Missing rate limiting", /(?:rateLimit|ratelimit|limiter|throttl|upstash|enforceRateLimit|requireProjectApiAccess|assertInternalOpsAuthorized)/i, {
    title: "Route has no visible rate limiting",
    description: "No local rate-limit control was recognized; infrastructure controls may exist.",
    severity: "low",
    confidence: "low",
    category: "availability",
    remediation: "Apply per-identity and per-IP limits to abuse-sensitive endpoints."
  }, ROUTE_RULE_EXCLUSIONS)
];
var backendRules = [
  patternRule("supabase.rls", "Supabase RLS", [{
    pattern: /ALTER\s+TABLE\s+[\w".]+\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    title: "Supabase/Postgres RLS disabled",
    description: "Row-level security is explicitly disabled.",
    severity: "high",
    confidence: "high",
    category: "authorization",
    remediation: "Enable RLS and define least-privilege policies.",
    path: /\.sql$/
  }, {
    pattern: /CREATE\s+POLICY[\s\S]*USING\s*\(\s*true\s*\)/i,
    title: "Permissive RLS policy",
    description: "The policy allows every row without a user predicate.",
    severity: "high",
    confidence: "high",
    category: "authorization",
    remediation: "Restrict the policy with authenticated user or tenant predicates.",
    path: /\.sql$/
  }]),
  patternRule("firebase.rules", "Firebase security", [{
    pattern: /allow\s+(?:read|write|read,\s*write)\s*:\s*if\s+true\s*;/i,
    title: "Firebase rule allows public access",
    description: "The rule grants unconditional access.",
    severity: "critical",
    confidence: "high",
    category: "authorization",
    remediation: "Require authenticated identity and resource-specific authorization.",
    path: /(?:firestore|storage)\.rules$/
  }, {
    pattern: /signInWithEmailAndPassword\s*\([^,]+,\s*["'][^"']+["']\s*\)/i,
    title: "Hard-coded Firebase password",
    description: "A password is embedded in a Firebase authentication call.",
    severity: "high",
    confidence: "high",
    category: "secrets",
    remediation: "Collect credentials securely and never commit passwords.",
    path: CODE_PATH
  }])
];
var missingSensitiveRls = {
  id: "supabase.rls-missing",
  title: "Sensitive table without visible RLS enablement",
  run: ({ files }) => {
    const sql = files.filter((file2) => file2.extension === ".sql");
    if (!repoExposesPostgresToClients(files)) return [];
    const combined = sql.map((file2) => file2.content).join("\n");
    const findings = [];
    const sensitive = /(?:users?|profiles?|accounts?|organizations?|projects?|payments?|customers?|sessions?|tokens?)/i;
    for (const file2 of sql) {
      for (let index = 0; index < file2.lines.length; index += 1) {
        const match = file2.lines[index].match(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?["']?([\w-]+)["']?/i);
        if (!match || !sensitive.test(match[1])) continue;
        const escaped = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`alter\\s+table\\s+(?:public\\.)?["']?${escaped}["']?\\s+enable\\s+row\\s+level\\s+security`, "i").test(combined)) continue;
        findings.push({
          ruleId: "supabase.rls-missing",
          title: "Sensitive table has no visible RLS enablement",
          description: `Table ${match[1]} is created without a matching ENABLE ROW LEVEL SECURITY statement in the analyzed SQL.`,
          severity: "high",
          confidence: "medium",
          category: "authorization",
          location: { path: file2.path, line: index + 1 },
          evidence: `CREATE TABLE ${match[1]}`,
          remediation: "Enable RLS and add least-privilege policies before exposing the table through Supabase.",
          fingerprintMaterial: match[1]
        });
      }
    }
    return findings;
  }
};
var BUILTIN_RULES = [
  exposedSecrets,
  publicEnvSecrets,
  serviceRoleInClient,
  ...injectionRules,
  ...configurationRules,
  missingNextSecurityHeaders,
  ...routeRules,
  ...backendRules,
  missingSensitiveRls
];

// features/security-scanner/rules/extended-rules.ts
var TEST_OR_EXAMPLE3 = TEST_OR_EXAMPLE_PATH;
var ROUTE_PATH2 = /(?:^|\/)(?:api|routes?|controllers?|handlers?)(?:\/|$)|route\.[jt]s$/i;
var CODE_PATH2 = /\.(?:[cm]?[jt]sx?|py|rb|go|java|php)$/i;
var SERVER_SIDE_PATH = /(?:^|\/)(?:server\/|app\/api\/|pages\/api\/|lib\/.*(?:server|api))/i;
var MOCK_RUNTIME_PATH = /(?:^|\/)server\/ai-red-team\/|mock-api-runtime|playwright-runtime|register-default-api-specialists/i;
var AUTH_ROUTE = /(?:login|signin|signup|register|password|reset|otp|verify|auth|magic-link|forgot)/i;
var ADMIN_ROUTE = /(?:admin|internal|moderator|superuser|privileged)/i;
var RECOGNIZED_RATE_LIMIT = /(?:rateLimit|ratelimit|limiter|throttl|upstash|enforceRateLimit|slowDown|express-rate-limit|@upstash\/ratelimit)/i;
var injectionExtended = [
  patternRule("injection.ssrf", "Server-side request forgery", [{
    pattern: /\b(?:fetch|axios|got|request|http\.get|https\.get)\s*\(\s*(?:`[^`]*\$\{[^}]*(?:req\.|request\.|params|query|body|searchParams)[^}]*\}|[^)]*(?:req\.|request\.|params|query|body|searchParams))/i,
    title: "User-controlled outbound request URL",
    description: "A request value may determine the destination of a server-side HTTP call (SSRF risk).",
    severity: "high",
    confidence: "medium",
    category: "injection",
    remediation: "Allowlist outbound hosts, block private IP ranges, and never pass raw user input to fetch URLs.",
    path: SERVER_SIDE_PATH,
    excludePath: /(?:test|spec|features\/security-scanner|mock-api-runtime|playwright-runtime)/i
  }]),
  patternRule("injection.deserialization", "Unsafe deserialization", [{
    pattern: /\b(?:unserialize\s*\(|serialize\.unserialize\s*\(|eval\s*\(|new\s+Function\s*\()/i,
    title: "Unsafe deserialization or dynamic code execution",
    description: "Untrusted data may be deserialized or executed as code.",
    severity: "critical",
    confidence: "high",
    category: "injection",
    remediation: "Use JSON with explicit schemas; never deserialize executable payloads.",
    path: CODE_PATH2,
    excludePath: /(?:test|spec|features\/security-scanner|features\/security-analysis|server\/ai-red-team\/teams\/browser|server\/ai-red-team\/llm-team\/runtime\/simulation-engines)/i
  }])
];
var authExtended = [
  patternRule("auth.admin-route", "Unprotected admin route", [{
    pattern: /(?:app\/api|pages\/api|routes)[^"\n]*admin[^"\n]*(?:route|handler|GET|POST)/i,
    title: "Admin route path detected",
    description: "An admin-scoped route exists \u2014 verify server-side role checks on every handler.",
    severity: "high",
    confidence: "low",
    category: "authorization",
    remediation: "Require authenticated admin role before any admin route handler logic.",
    path: /(?:route\.[jt]s|admin)/i
  }]),
  patternRule("auth.oauth-insecure", "Insecure OAuth configuration", [{
    pattern: /(?:oauth|OAuth)[\s\S]{0,200}(?:state\s*:\s*false|skipState|allowDangerousEmailAccountLinking\s*:\s*true)/i,
    title: "OAuth flow may skip CSRF/state protection",
    description: "OAuth configuration appears to disable state validation or allow dangerous account linking.",
    severity: "high",
    confidence: "medium",
    category: "authentication",
    remediation: "Require state parameter validation and restrict account linking policies.",
    path: CODE_PATH2,
    excludePath: /(?:test|spec|features\/security-scanner)/i
  }]),
  patternRule("auth.session-client-storage", "Session token in client storage", [{
    pattern: /localStorage\.(?:setItem|getItem)\s*\([^)]*(?:token|auth|session|jwt|access)/i,
    title: "Authentication token stored in localStorage",
    description: "Browser localStorage is readable by XSS \u2014 prefer HttpOnly cookies for session tokens.",
    severity: "high",
    confidence: "medium",
    category: "authentication",
    remediation: "Store session tokens in HttpOnly, Secure cookies instead of localStorage.",
    path: CODE_PATH2,
    excludePath: TEST_OR_EXAMPLE3
  }]),
  patternRule("auth.password-reset-exposed", "Password reset flow risks", [{
    pattern: /(?:resetPassword|forgotPassword|sendPasswordReset|recoverPassword)[\s\S]{0,120}(?:console\.log|return\s+token)/i,
    title: "Password reset may leak tokens or codes",
    description: "Password reset logic may log or return reset tokens to clients.",
    severity: "high",
    confidence: "medium",
    category: "authentication",
    remediation: "Never log or return reset tokens; use single-use expiring tokens server-side only.",
    path: CODE_PATH2
  }])
];
var apiExtended = [
  patternRule("api.mass-assignment", "Mass assignment", [{
    pattern: /(?:req\.body|request\.json|body)\s*[\s\S]{0,80}(?:role\s*[:=]|isAdmin|admin\s*[:=]|permissions\s*[:=]|organizationId\s*[:=])/i,
    title: "Privileged field may be accepted from request body",
    description: "Request body handling references privileged fields that attackers may tamper with.",
    severity: "high",
    confidence: "medium",
    category: "authorization",
    remediation: "Use explicit allowlists for writable fields; never bind role or admin flags from client input.",
    path: ROUTE_PATH2,
    excludePath: MOCK_RUNTIME_PATH
  }]),
  patternRule("api.error-leakage", "Verbose error responses", [{
    pattern: /(?:res\.(?:json|send)|NextResponse\.json)\s*\([^)]*(?:stackTrace|details:\s*error\.stack)/i,
    title: "API may return verbose error details",
    description: "Error responses may expose stack traces or internal details to clients.",
    severity: "medium",
    confidence: "medium",
    category: "api",
    remediation: "Return generic errors to clients; log details server-side only.",
    path: CODE_PATH2,
    excludePath: TEST_OR_EXAMPLE3
  }]),
  patternRule("api.dangerous-method", "Dangerous HTTP method exposure", [{
    pattern: /export\s+async\s+function\s+(?:TRACE|TRACK|CONNECT)\b/i,
    title: "Uncommon HTTP method exported on route",
    description: "TRACE/TRACK/CONNECT methods can expose proxy or debugging behavior.",
    severity: "low",
    confidence: "high",
    category: "api",
    remediation: "Disable uncommon HTTP methods at the framework or edge layer.",
    path: ROUTE_PATH2
  }])
];
var webExtended = [
  patternRule("web.csrf-missing", "Missing CSRF protection", [{
    pattern: /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)[\s\S]{0,400}(?!csrf|CSRF|csrfToken|doubleSubmit|sameSite|getServerSession|auth\(|requireAuth|getSession)/i,
    title: "Mutating route without visible CSRF protection",
    description: "State-changing handler lacks recognizable CSRF token or double-submit validation.",
    severity: "medium",
    confidence: "low",
    category: "web",
    remediation: "Validate CSRF tokens or use SameSite cookies with anti-CSRF patterns for browser clients.",
    path: /(?:^|\/)app\/(?!api\/)/i,
    excludePath: new RegExp(`${TEST_OR_EXAMPLE3.source}|${MACHINE_ENDPOINT_PATH.source}`, "i")
  }]),
  patternRule("frontend.client-authz", "Client-side authorization check", [{
    pattern: /(?:if\s*\(\s*(?:user\.role|session\.user\.role|isAdmin|permissions))[\s\S]{0,200}(?:return|null|<Redirect)/i,
    title: "Authorization enforced only in client UI",
    description: "Role or permission checks appear in UI code without guaranteed server enforcement.",
    severity: "high",
    confidence: "low",
    category: "authorization",
    remediation: "Enforce authorization on the server for every protected action; UI checks are not security boundaries.",
    path: /\.(?:jsx|tsx)$/
  }])
];
var databaseExtended = [
  patternRule("database.unsafe-raw-query", "Unsafe raw database query", [{
    pattern: /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(\s*(?:`[^`]*\$\{|[^)]*(?:req\.|request\.|params|query|body))/i,
    title: "Unsafe raw SQL with dynamic input",
    description: "Prisma or ORM raw query may interpolate untrusted values.",
    severity: "critical",
    confidence: "high",
    category: "database",
    remediation: "Use parameterized queries or tagged template APIs; never concatenate user input into raw SQL.",
    path: CODE_PATH2
  }])
];
var cicdExtended = [
  patternRule("cicd.github-actions-secrets", "GitHub Actions secret exposure", [{
    pattern: /(?:secrets\.|GITHUB_TOKEN|env:\s*\n[\s\S]*(?:password|api_key|secret|token):\s*['"][^'"]+['"])/i,
    title: "Workflow may expose or mishandle secrets",
    description: "GitHub Actions workflow references secrets or hard-coded credentials in env blocks.",
    severity: "high",
    confidence: "medium",
    category: "cicd",
    remediation: "Use GitHub encrypted secrets only; never commit credentials in workflow files.",
    path: /^\.github\/workflows\/.+\.ya?ml$/i
  }]),
  patternRule("cicd.github-actions-permissions", "GitHub Actions excessive permissions", [{
    pattern: /permissions:\s*\n[\s\S]*(?:write-all|contents:\s*write|pull-requests:\s*write)[\s\S]*pull_request_target/i,
    title: "Workflow uses pull_request_target with broad permissions",
    description: "pull_request_target with write permissions is a common supply-chain attack vector.",
    severity: "high",
    confidence: "high",
    category: "cicd",
    remediation: "Avoid pull_request_target with write permissions; use least-privilege workflow permissions.",
    path: /^\.github\/workflows\/.+\.ya?ml$/i
  }, {
    pattern: /permissions:\s*write-all/i,
    title: "GitHub Actions workflow grants write-all permissions",
    description: "Overly broad workflow permissions increase supply-chain risk.",
    severity: "medium",
    confidence: "high",
    category: "cicd",
    remediation: "Set explicit least-privilege permissions for each workflow job.",
    path: /^\.github\/workflows\/.+\.ya?ml$/i
  }])
];
var validationExtended = [
  contextualRouteRule(
    "validation.client-only-risk",
    "Missing server-side validation on mutating route",
    /(?:\.parse\(|safeParse|\.safeParse|validate|schema|joi\.|yup\.|zod|valibot|validator|superRefine|parseBody|parseJsonBody|from\s+["']zod["'])/i,
    {
      title: "Mutating route lacks visible server-side validation",
      description: "Handler accepts mutations without recognizable schema validation \u2014 client-side validation alone is insufficient.",
      severity: "medium",
      confidence: "medium",
      category: "validation",
      remediation: "Validate all mutating inputs with a server-side schema before processing."
    },
    {
      excludePath: /(?:\/auth\/callback\/|\/webhooks\/)/,
      includeContent: /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)[\s\S]{0,600}(?:request\.json|req\.json|req\.body|request\.body)/i
    }
  )
];
var rateLimitAuthRoutes = [
  {
    id: "rate-limit.auth-missing",
    title: "Missing rate limiting on authentication routes",
    run: ({ files }) => files.filter(
      (file2) => ROUTE_PATH2.test(file2.path) && AUTH_ROUTE.test(file2.path) && !/\/internal\//.test(file2.path) && /(?:export\s+async\s+function\s+(?:POST|GET)|\.(?:post|get)\s*\()/i.test(file2.content)
    ).filter((file2) => !RECOGNIZED_RATE_LIMIT.test(file2.content)).map((file2) => ({
      ruleId: "rate-limit.auth-missing",
      title: "Authentication route lacks visible rate limiting",
      description: "Login, signup, or password reset endpoints without recognizable throttling are vulnerable to brute-force and abuse.",
      severity: "high",
      confidence: "medium",
      category: "availability",
      location: { path: file2.path, line: 1 },
      evidence: `auth-route=${file2.path}`,
      remediation: "Apply per-IP and per-identity rate limits on authentication and password reset endpoints.",
      fingerprintMaterial: file2.path
    }))
  },
  {
    id: "rate-limit.admin-missing",
    title: "Missing rate limiting on admin routes",
    run: ({ files }) => files.filter(
      (file2) => ROUTE_PATH2.test(file2.path) && ADMIN_ROUTE.test(file2.path) && !/\/internal\//.test(file2.path) && /(?:export\s+async\s+function|router\.|app\.)/i.test(file2.content)
    ).filter((file2) => !RECOGNIZED_RATE_LIMIT.test(file2.content)).map((file2) => ({
      ruleId: "rate-limit.admin-missing",
      title: "Admin or privileged route lacks visible rate limiting",
      description: "Sensitive admin endpoints should enforce strict rate limits.",
      severity: "medium",
      confidence: "medium",
      category: "availability",
      location: { path: file2.path, line: 1 },
      evidence: `admin-route=${file2.path}`,
      remediation: "Add rate limiting and audit logging on admin endpoints.",
      fingerprintMaterial: file2.path
    }))
  }
];
var rlsAssessmentRule = {
  id: "database.rls-assessment",
  title: "Row Level Security assessment",
  run: ({ files }) => {
    const sqlFiles = files.filter((f) => f.extension === ".sql");
    if (sqlFiles.length === 0) return [];
    const combined = sqlFiles.map((f) => f.content).join("\n");
    const clientExposed = repoExposesPostgresToClients(files);
    const findings = [];
    const tables = [];
    for (const file2 of sqlFiles) {
      file2.lines.forEach((line, index) => {
        const match = line.match(
          /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?["']?([\w-]+)["']?/i
        );
        if (match) tables.push({ name: match[1], path: file2.path, line: index + 1 });
      });
    }
    for (const table of tables) {
      const escaped = table.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const enabled = new RegExp(
        `alter\\s+table\\s+(?:public\\.)?["']?${escaped}["']?\\s+enable\\s+row\\s+level\\s+security`,
        "i"
      ).test(combined);
      const disabled = new RegExp(
        `alter\\s+table\\s+(?:public\\.)?["']?${escaped}["']?\\s+disable\\s+row\\s+level\\s+security`,
        "i"
      ).test(combined);
      const permissive = new RegExp(
        `create\\s+policy[\\s\\S]*on\\s+(?:public\\.)?["']?${escaped}["']?[\\s\\S]*using\\s*\\(\\s*true\\s*\\)`,
        "i"
      ).test(combined);
      if (disabled) {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS FAIL: ${table.name} has RLS disabled`,
          description: "Row Level Security is explicitly disabled on a table.",
          severity: "high",
          confidence: "high",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=DISABLED;table=${table.name}`,
          remediation: "Enable RLS and add least-privilege policies.",
          fingerprintMaterial: `${table.name}:disabled`,
          metadata: { rlsStatus: "FAIL" }
        });
      } else if (permissive) {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS FAIL: permissive policy on ${table.name}`,
          description: "An RLS policy uses USING (true) allowing unrestricted access.",
          severity: "high",
          confidence: "high",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=FAIL;policy=USING(true);table=${table.name}`,
          remediation: "Replace permissive policies with tenant/user-scoped predicates.",
          fingerprintMaterial: `${table.name}:permissive`,
          metadata: { rlsStatus: "FAIL" }
        });
      } else if (!enabled && clientExposed) {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS FAIL: ${table.name} without visible RLS enablement`,
          description: "Table created without matching ENABLE ROW LEVEL SECURITY in analyzed SQL.",
          severity: "high",
          confidence: "medium",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=FAIL;table=${table.name}`,
          remediation: "Enable RLS before exposing the table through Supabase or Postgres APIs.",
          fingerprintMaterial: `${table.name}:missing`,
          metadata: { rlsStatus: "FAIL" }
        });
      } else if (!enabled) {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `No RLS on ${table.name} \u2014 verify backend-layer authorization instead`,
          description: "Table has no ENABLE ROW LEVEL SECURITY statement, but no Supabase/PostgREST client exposure was detected in this repo. RLS only matters when Postgres is reached directly by an untrusted client; a backend-mediated app should enforce ownership checks in its query layer instead.",
          severity: "low",
          confidence: "low",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=NOT_APPLICABLE;table=${table.name}`,
          remediation: "Verify the backend scopes every query for this table by the authenticated user/tenant.",
          fingerprintMaterial: `${table.name}:not-applicable`,
          metadata: { rlsStatus: "NOT_APPLICABLE" }
        });
      } else {
        findings.push({
          ruleId: "database.rls-assessment",
          title: `RLS PASS: ${table.name}`,
          description: "Row Level Security appears enabled for this table.",
          severity: "info",
          confidence: "high",
          category: "database",
          location: { path: table.path, line: table.line },
          evidence: `RLS=PASS;table=${table.name}`,
          remediation: "Keep policies reviewed on each migration.",
          fingerprintMaterial: `${table.name}:pass`,
          metadata: { rlsStatus: "PASS" }
        });
      }
    }
    return findings;
  }
};
var EXTENDED_RULES = [
  ...injectionExtended,
  ...authExtended,
  ...apiExtended,
  ...webExtended,
  ...databaseExtended,
  ...cicdExtended,
  ...validationExtended,
  ...rateLimitAuthRoutes,
  rlsAssessmentRule
];

// features/security-analysis/shared/constants.ts
var SCAN_SKIP_DIR_SEGMENTS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "venv",
  ".venv",
  "coverage",
  ".next",
  ".nuxt"
]);

// features/security-analysis/agent-action/constants.ts
var AGENT_ACTION_RULE_ID = "agent-action.security";
var AGENT_ACTION_SOURCE_TOOL = "scan_agent_action";
var AGENT_ACTION_SKIP_DIRS = SCAN_SKIP_DIR_SEGMENTS;
var AGENT_TOOL_DEFINITION_MARKERS = [
  /server\.tool\s*\(/,
  /\.registerTool\s*\(/,
  /defineTool\s*\(/,
  /createTool\s*\(/,
  /new\s+DynamicTool\s*\(/,
  /new\s+StructuredTool\s*\(/,
  /new\s+Tool\s*\(/,
  /ChatCompletionTool\s*\(/,
  /tool\s*\(\s*\{[\s\S]{0,120}?name\s*:/,
  /tools\s*:\s*\[[\s\S]{0,200}?type\s*:\s*["']function["']/
];
var VALIDATION_INDICATORS = /\b(schema\.parse|safeParse|\.parse\s*\(|\.safeParse\s*\(|validate\s*\(|sanitize\s*\(|allowlist|allowList|whitelist|isAllowed|assertValid|checkCommand|if\s*\(\s*!.*includes|\.includes\s*\(|\.max\s*\(\s*\d+|\.min\s*\(\s*\d+)/i;
var USER_INPUT_INDICATORS = /\b(args|input|params|toolInput|userInput|request|req|body|message|command|cmd|path|url|query)\b|\$\{(?:args|input|params|req|body|cmd|path|url)/i;
var AGENT_ACTION_CATEGORY_REMEDIATION = {
  "agent-capability": "Review whether this agent tool capability is required in production and restrict it with allowlists and human approval.",
  "agent-shell": "Avoid granting agents arbitrary shell execution. Use fixed commands, argument arrays, and strict validation.",
  "agent-filesystem": "Confine agent file access to an explicit workspace directory and validate paths before read/write/delete.",
  "agent-network": "Allowlist outbound URLs for agent HTTP tools and block access to internal/private addresses.",
  "agent-git": "Prevent destructive git operations from agent tools unless explicitly approved and audited.",
  "agent-docker": "Do not expose privileged Docker operations to agents. Use isolated sandboxes with minimal mounts.",
  "agent-secrets": "Keep credentials out of agent-accessible paths and never expose environment secrets through agent tools."
};
var CAPABILITY_TOOL_NAME_PATTERNS = {
  bash: /^(bash|shell|run_?command|runCommand|terminal|execute_?command)$/i,
  file_write: /^(write_?file|writeFile|create_?file|save_?file|edit_?file)$/i,
  file_read: /^(read_?file|readFile|get_?file|load_?file)$/i,
  file_delete: /^(delete_?file|remove_?file|unlink|rm_?file)$/i,
  http_request: /^(http_?request|fetch|web_?request|curl|request_?url)$/i,
  cron: /^(cron|schedule|scheduled_?task)$/i,
  process_spawn: /^(spawn|process|run_?process|subprocess)$/i,
  git: /^(git|git_?command|git_?operation)$/i,
  docker: /^(docker|container|docker_?run)$/i
};
var HANDLER_CAPABILITY_PATTERNS = [
  { actionType: "bash", pattern: /\b(exec|execSync|spawn|spawnSync)\s*\(/, category: "agent-shell" },
  { actionType: "bash", pattern: /\bchild_process\b/, category: "agent-shell" },
  { actionType: "bash", pattern: /subprocess\.(run|call|Popen)/, category: "agent-shell" },
  { actionType: "bash", pattern: /\bos\.system\s*\(/, category: "agent-shell" },
  { actionType: "file_write", pattern: /\b(writeFile|writeFileSync|appendFile|createWriteStream)\s*\(/, category: "agent-filesystem" },
  { actionType: "file_read", pattern: /\b(readFile|readFileSync|createReadStream)\s*\(/, category: "agent-filesystem" },
  { actionType: "file_delete", pattern: /\b(unlink|unlinkSync|rmSync|rmdir|deleteFile)\s*\(/, category: "agent-filesystem" },
  { actionType: "http_request", pattern: /\b(fetch|axios\.|http\.request|https\.request|got\s*\()\s*\(/, category: "agent-network" },
  { actionType: "git", pattern: /\bgit\s+(push|reset|clean|remote|config)/, category: "agent-git" },
  { actionType: "docker", pattern: /\bdocker\s+(run|exec|build)\b/, category: "agent-docker" },
  { actionType: "process_spawn", pattern: /\b(spawn|spawnSync|Popen)\s*\(/, category: "agent-shell" },
  { actionType: "cron", pattern: /@reboot|cron\.schedule/, category: "agent-shell" }
];

// features/security-analysis/agent-action/action-checks.ts
var BASH_RULES = [
  {
    rule: "bash.destructive.rm-rf",
    pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*rf[a-zA-Z]*|-[a-zA-Z]*fr[a-zA-Z]*)\s+[/~*]/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Destructive recursive force-delete targeting root, home, or wildcard path"
  },
  {
    rule: "bash.rce.curl-pipe-sh",
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|ksh|dash|python|perl|ruby)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Remote code execution: piping downloaded content directly into a shell interpreter"
  },
  {
    rule: "bash.sql.drop-table",
    pattern: /\bDROP\s+TABLE\b/i,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "SQL DROP TABLE detected - destructive database operation"
  },
  {
    rule: "bash.sql.delete-no-where",
    pattern: /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/i,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "SQL DELETE FROM without WHERE clause - will delete all rows"
  },
  {
    rule: "bash.disk.dd",
    pattern: /\bdd\s+if=/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Low-level disk write via dd - can destroy disk contents"
  },
  {
    rule: "bash.credential.ssh-key-read",
    pattern: /\bcat\s+~?\/?\.ssh\/id_(rsa|ed25519|ecdsa|dsa)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Attempting to read SSH private key"
  },
  {
    rule: "bash.credential.aws-creds",
    pattern: /\bcat\s+~?\/?\.aws\/credentials\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Attempting to read AWS credentials file"
  },
  {
    rule: "bash.permissions.chmod-777",
    pattern: /\bchmod\s+(777|666)\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Overly permissive file permissions (world-readable/writable)"
  },
  {
    rule: "bash.escalation.sudo",
    pattern: /\bsudo\b/,
    severity: "MEDIUM",
    action: "WARN",
    message: "Privilege escalation via sudo"
  },
  {
    rule: "bash.git.force-push",
    pattern: /\bgit\s+push\s+--force\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Git force push - can overwrite remote history and cause data loss"
  }
];
var CRON_RULES = [
  {
    rule: "cron.rce.curl-pipe",
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|python|perl|ruby)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Cron entry downloads and executes remote code"
  },
  {
    rule: "cron.persistence.at-boot",
    pattern: /@reboot/,
    severity: "HIGH",
    action: "WARN",
    message: "Cron entry runs at reboot \u2014 potential persistence mechanism"
  }
];
var PROCESS_SPAWN_RULES = [
  {
    rule: "process_spawn.reverse-shell",
    pattern: /\b(nc|ncat|netcat)\s+.*-e\s+\/bin\/(sh|bash)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Reverse shell via netcat"
  },
  {
    rule: "process_spawn.privilege-escalation",
    pattern: /\bsudo\b/,
    severity: "MEDIUM",
    action: "WARN",
    message: "Process spawned with elevated privileges via sudo"
  }
];
var GIT_RULES = [
  {
    rule: "git.destructive.force-push",
    pattern: /\bgit\s+push\s+.*--force\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Git force push \u2014 can overwrite remote history and cause data loss"
  },
  {
    rule: "git.destructive.reset-hard",
    pattern: /\bgit\s+reset\s+--hard\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Git hard reset \u2014 discards all uncommitted changes"
  }
];
var DOCKER_RULES = [
  {
    rule: "docker.privileged",
    pattern: /--privileged/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Docker container with --privileged flag \u2014 full host access"
  },
  {
    rule: "docker.host-mount.root",
    pattern: /-v\s+\/:/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Docker container mounts host root filesystem"
  },
  {
    rule: "docker.host-mount.docker-sock",
    pattern: /-v\s+\/var\/run\/docker\.sock/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Docker container mounts Docker socket \u2014 can control host Docker daemon"
  }
];
var SENSITIVE_FILE_PATTERNS = [
  { pattern: /(^|\/)\.env($|\.)/, label: ".env file", severity: "HIGH" },
  { pattern: /(^|\/)\.ssh\//, label: "SSH directory", severity: "CRITICAL" },
  { pattern: /credentials/i, label: "credentials file", severity: "HIGH" },
  { pattern: /secrets/i, label: "secrets file", severity: "HIGH" }
];
var SYSTEM_FILE_PATTERNS = [
  { pattern: /^\/etc\//, label: "/etc system config", severity: "CRITICAL" },
  { pattern: /^\/usr\//, label: "/usr system directory", severity: "CRITICAL" },
  { pattern: /^\/bin\//, label: "/bin system binaries", severity: "CRITICAL" }
];
var CREDENTIAL_READ_PATTERNS = [
  { pattern: /(^|\/)\.env($|\.)/, label: ".env file", severity: "MEDIUM" },
  { pattern: /\.pem$/, label: "PEM certificate/key", severity: "HIGH" },
  { pattern: /(^|\/)\.ssh\//, label: "SSH directory", severity: "HIGH" },
  { pattern: /secret/i, label: "secret file", severity: "HIGH" }
];
var PRIVATE_IP_PATTERNS = [
  { pattern: /\b127\.0\.0\.1\b/, label: "loopback address (127.0.0.1)" },
  { pattern: /\blocalhost\b/, label: "localhost" },
  { pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, label: "private IP (10.x.x.x)" },
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/, label: "private IP (192.168.x.x)" }
];
var EXFILTRATION_PATTERNS = [
  { pattern: /webhook\.site/i, label: "webhook.site" },
  { pattern: /ngrok\.io/i, label: "ngrok tunnel" },
  { pattern: /pipedream/i, label: "Pipedream" }
];
function runRules(value, rules) {
  const findings = [];
  const normalized = value.toLowerCase();
  for (const rule of rules) {
    if (rule.pattern.test(value) || rule.pattern.test(normalized)) {
      findings.push({
        rule: rule.rule,
        severity: rule.severity,
        action: rule.action,
        message: rule.message
      });
    }
  }
  return findings;
}
function checkAgentAction(actionType, actionValue) {
  switch (actionType) {
    case "bash":
      return runRules(actionValue, BASH_RULES);
    case "cron": {
      const findings = runRules(actionValue, CRON_RULES);
      const cmdPortion = actionValue.replace(/^[@*0-9,\-/\\s]+/, "").trim();
      return cmdPortion ? [...findings, ...runRules(cmdPortion, BASH_RULES)] : findings;
    }
    case "process_spawn":
      return [...runRules(actionValue, PROCESS_SPAWN_RULES), ...runRules(actionValue, BASH_RULES)];
    case "git":
      return runRules(actionValue, GIT_RULES);
    case "docker":
      return runRules(actionValue, DOCKER_RULES);
    case "file_write": {
      const findings = [];
      for (const pattern of SYSTEM_FILE_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_write.system.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "CRITICAL",
            action: "BLOCK",
            message: `Writing to system path (${pattern.label}) is blocked`
          });
        }
      }
      for (const pattern of SENSITIVE_FILE_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_write.sensitive.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: pattern.severity,
            action: "WARN",
            message: `Writing to sensitive file (${pattern.label}) - review carefully`
          });
        }
      }
      return findings;
    }
    case "file_read": {
      const findings = [];
      for (const pattern of CREDENTIAL_READ_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_read.credential.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: pattern.severity,
            action: "WARN",
            message: `Reading credential/sensitive file (${pattern.label}) - potential secret exposure`
          });
        }
      }
      return findings;
    }
    case "file_delete": {
      const findings = [];
      for (const pattern of [...SYSTEM_FILE_PATTERNS, ...SENSITIVE_FILE_PATTERNS]) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_delete.sensitive.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "CRITICAL",
            action: "BLOCK",
            message: `Deleting sensitive file (${pattern.label}) is blocked`
          });
        }
      }
      return findings;
    }
    case "http_request": {
      const findings = [];
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `http.ssrf.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "CRITICAL",
            action: "BLOCK",
            message: `SSRF risk: request targets internal/private address (${pattern.label})`
          });
        }
      }
      for (const pattern of EXFILTRATION_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `http.exfiltration.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "HIGH",
            action: "WARN",
            message: `Potential data exfiltration: request targets known exfiltration service (${pattern.label})`
          });
        }
      }
      return findings;
    }
    default:
      return [];
  }
}
function severityToConfidence(severity) {
  switch (severity) {
    case "CRITICAL":
      return "HIGH";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    default:
      return "LOW";
  }
}
function mapSeverityToExternal(severity) {
  switch (severity) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    default:
      return "LOW";
  }
}

// features/security-analysis/agent-action/discover.ts
function hasAgentToolDefinitions(content) {
  return AGENT_TOOL_DEFINITION_MARKERS.some((pattern) => pattern.test(content));
}
function discoverAgentTools(path, content) {
  if (!hasAgentToolDefinitions(content)) return [];
  const tools = [];
  const lines = content.split("\n");
  const patterns = [
    { regex: /server\.tool\s*\(\s*["']([^"']+)["']/g, framework: "mcp" },
    { regex: /\.registerTool\s*\(\s*["']([^"']+)["']/g, framework: "ai-sdk" },
    { regex: /defineTool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "ai-sdk" },
    { regex: /createTool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "ai-sdk" },
    { regex: /new\s+DynamicTool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "langchain" },
    { regex: /new\s+Tool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "langchain" },
    { regex: /name\s*:\s*["']([^"']+)["'][\s\S]{0,120}?description\s*:/g, framework: "generic" }
  ];
  for (const { regex, framework } of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]?.trim();
      if (!name) continue;
      const line = content.slice(0, match.index).split("\n").length;
      const block = extractToolBlock(content, match.index, lines.length);
      if (tools.some((tool) => tool.name === name && tool.line === line)) continue;
      tools.push({ name, line, block, framework });
    }
  }
  return tools;
}
function extractToolBlock(content, startIndex, totalLines) {
  const fromLine = content.slice(0, startIndex).split("\n").length - 1;
  const lines = content.split("\n");
  const endLine = Math.min(fromLine + 40, totalLines);
  return lines.slice(fromLine, endLine).join("\n");
}
function inferActionTypeFromToolName(toolName) {
  for (const [actionType, pattern] of Object.entries(CAPABILITY_TOOL_NAME_PATTERNS)) {
    if (pattern.test(toolName)) return actionType;
  }
  return null;
}
function inferActionTypesFromHandler(block) {
  const types = /* @__PURE__ */ new Set();
  for (const entry of HANDLER_CAPABILITY_PATTERNS) {
    if (entry.pattern.test(block)) {
      types.add(entry.actionType);
    }
  }
  return [...types];
}
function handlerUsesUserInput(block) {
  return USER_INPUT_INDICATORS.test(block);
}
function handlerHasValidation(block) {
  return VALIDATION_INDICATORS.test(block);
}
function extractActionValues(block, actionType) {
  const values = /* @__PURE__ */ new Set();
  const stringPatterns = [
    /["']([^"']{3,200})["']/g,
    /`([^`]{3,200})`/g
  ];
  for (const pattern of stringPatterns) {
    let match;
    while ((match = pattern.exec(block)) !== null) {
      const value = match[1]?.trim();
      if (!value || value.includes("${")) continue;
      if (isRelevantValue(actionType, value)) {
        values.add(value);
      }
    }
  }
  return [...values];
}
function isRelevantValue(actionType, value) {
  switch (actionType) {
    case "bash":
    case "process_spawn":
    case "cron":
    case "git":
    case "docker":
      return /\b(rm|curl|wget|git|docker|sudo|chmod|dd|DROP|DELETE|spawn|exec|nc)\b/i.test(value);
    case "file_write":
    case "file_read":
    case "file_delete":
      return /\/|\.env|\.ssh|\.pem|credentials|secret|package\.json/i.test(value);
    case "http_request":
      return /^https?:\/\//i.test(value) || /\blocalhost\b|\b127\.0\.0\.1\b/.test(value);
    default:
      return false;
  }
}
function categoryForActionType(actionType) {
  switch (actionType) {
    case "bash":
    case "process_spawn":
    case "cron":
      return "agent-shell";
    case "file_write":
    case "file_read":
    case "file_delete":
      return "agent-filesystem";
    case "http_request":
      return "agent-network";
    case "git":
      return "agent-git";
    case "docker":
      return "agent-docker";
    default:
      return "agent-capability";
  }
}
function isAgentRelatedPath(path) {
  return /(?:^|\/)((mcp|agent|agents|tools)(\/|$))/i.test(path);
}

// features/security-analysis/agent-action/scan-file.ts
function tierForCapabilityOnly() {
  return "capability-detected";
}
function tierForCheckFinding(finding, hasUserInput, hasValidation) {
  if (finding.action === "BLOCK" && hasUserInput && !hasValidation) {
    return "likely-exploitable";
  }
  if (finding.action === "BLOCK" || finding.severity === "CRITICAL") {
    return "potentially-dangerous";
  }
  if (hasUserInput && !hasValidation) {
    return "insufficient-restrictions";
  }
  return "potentially-dangerous";
}
function confidenceForTier(tier, base) {
  if (tier === "capability-detected") return "LOW";
  if (tier === "insufficient-restrictions") return base === "HIGH" ? "MEDIUM" : "LOW";
  return base;
}
function scanTool(path, tool) {
  const findings = [];
  const actionTypes = /* @__PURE__ */ new Set();
  const nameType = inferActionTypeFromToolName(tool.name);
  if (nameType) actionTypes.add(nameType);
  for (const type of inferActionTypesFromHandler(tool.block)) {
    actionTypes.add(type);
  }
  const hasUserInput = handlerUsesUserInput(tool.block);
  const hasValidation = handlerHasValidation(tool.block);
  for (const actionType of actionTypes) {
    if (nameType === actionType && !extractActionValues(tool.block, actionType).length) {
      findings.push({
        rule: `agent.capability.${actionType}`,
        severity: "MEDIUM",
        action: "WARN",
        message: `Agent tool "${tool.name}" exposes ${actionType.replace(/_/g, " ")} capability to the model.`,
        category: categoryForActionType(actionType),
        file: path,
        line: tool.line,
        match: tool.name,
        confidence: "LOW",
        tier: tierForCapabilityOnly(),
        actionType,
        toolName: tool.name
      });
    }
    for (const actionValue of extractActionValues(tool.block, actionType)) {
      for (const check2 of checkAgentAction(actionType, actionValue)) {
        const tier = tierForCheckFinding(check2, hasUserInput, hasValidation);
        const baseConfidence = severityToConfidence(check2.severity);
        findings.push({
          rule: check2.rule,
          severity: check2.severity,
          action: check2.action,
          message: `${check2.message} (agent tool "${tool.name}")`,
          category: categoryForActionType(actionType),
          file: path,
          line: tool.line,
          match: actionValue.slice(0, 100),
          confidence: confidenceForTier(tier, baseConfidence),
          tier,
          actionType,
          toolName: tool.name
        });
      }
    }
    if ((actionType === "bash" || actionType === "process_spawn" || actionType === "http_request") && hasUserInput && !hasValidation) {
      findings.push({
        rule: "agent.action.unvalidated-user-input",
        severity: "HIGH",
        action: "WARN",
        message: `Agent tool "${tool.name}" appears to pass user-controlled input into a ${actionType.replace(/_/g, " ")} capability without visible validation.`,
        category: categoryForActionType(actionType),
        file: path,
        line: tool.line,
        match: tool.name,
        confidence: "MEDIUM",
        tier: "insufficient-restrictions",
        actionType,
        toolName: tool.name
      });
    }
  }
  return findings;
}
function scanAgentActionFile(path, content) {
  if (!AGENT_TOOL_DEFINITION_MARKERS.some((pattern) => pattern.test(content))) {
    if (!isAgentRelatedPath(path)) {
      return [];
    }
  }
  const tools = discoverAgentTools(path, content);
  if (tools.length === 0) return [];
  const findings = [];
  for (const tool of tools) {
    findings.push(...scanTool(path, tool));
  }
  return dedupeAgentActionFindings(findings);
}
function dedupeAgentActionFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.rule}|${finding.file}|${finding.line}|${finding.toolName ?? ""}|${finding.match ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/agent-action/scan-repository.ts
function shouldSkipPath(path) {
  if (TEST_OR_EXAMPLE_PATH.test(path)) return true;
  return path.split("/").some((segment) => AGENT_ACTION_SKIP_DIRS.has(segment));
}
function isScannableFile(path) {
  return /\.(js|jsx|ts|tsx|py|json)$/i.test(path);
}
function scanAgentActionRepository(files) {
  const findings = [];
  let filesScanned = 0;
  let filesConsidered = 0;
  for (const file2 of files) {
    if (shouldSkipPath(file2.path)) continue;
    if (!isScannableFile(file2.path)) continue;
    filesConsidered += 1;
    const fileFindings = scanAgentActionFile(file2.path, file2.content);
    if (fileFindings.length > 0) {
      filesScanned += 1;
      findings.push(...fileFindings);
    }
  }
  return {
    findings: dedupeAgentActionFindings(findings),
    filesScanned,
    filesConsidered
  };
}

// features/security-analysis/constants.ts
var AGENT_SECURITY_SCANNER_ID = "agent-security-scanner-mcp";
var EXTERNAL_SECURITY_SOURCE_TOOLS = [
  "scan_security",
  "scan_agent_prompt",
  "scan_project",
  "scan_skill",
  "scan_mcp_server",
  "scan_agent_action",
  "scan_packages",
  "scan_diff",
  "osv",
  "sbom"
];

// features/security-analysis/derive-verification-status.ts
var HEURISTIC_SOURCE_TOOLS = /* @__PURE__ */ new Set([
  "scan_agent_prompt",
  "scan_skill",
  "scan_agent_action"
]);
var STATIC_SOURCE_TOOLS = /* @__PURE__ */ new Set([
  "scan_security",
  "scan_project",
  "scan_mcp_server",
  "scan_diff"
]);
function deriveInitialVerificationStatus(input) {
  if (HEURISTIC_SOURCE_TOOLS.has(input.sourceTool)) {
    if (input.action === "BLOCK" && input.confidence === "HIGH") {
      return "LIKELY";
    }
    return "UNVERIFIED";
  }
  if (input.sourceTool === "osv") {
    return input.confidence === "HIGH" ? "LIKELY" : "POTENTIAL";
  }
  if (input.sourceTool === "scan_packages") {
    if (input.confidence === "HIGH" && input.action === "BLOCK") {
      return "LIKELY";
    }
    return input.confidence === "HIGH" ? "POTENTIAL" : "UNVERIFIED";
  }
  if (STATIC_SOURCE_TOOLS.has(input.sourceTool)) {
    if (input.confidence === "HIGH") {
      return "POTENTIAL";
    }
    return "UNVERIFIED";
  }
  return "UNVERIFIED";
}

// features/security-analysis/schema.ts
var externalSeveritySchema = external_exports.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);
var externalConfidenceSchema = external_exports.enum(["HIGH", "MEDIUM", "LOW"]);
var agentActionSchema = external_exports.enum(["ALLOW", "WARN", "BLOCK"]);
var securityAnalysisFindingSchema = external_exports.object({
  scanner: external_exports.literal(AGENT_SECURITY_SCANNER_ID),
  sourceTool: external_exports.enum(EXTERNAL_SECURITY_SOURCE_TOOLS),
  ruleId: external_exports.string().min(1),
  externalRuleId: external_exports.string().min(1),
  title: external_exports.string().min(1),
  description: external_exports.string(),
  message: external_exports.string(),
  category: external_exports.string().nullable(),
  severity: externalSeveritySchema,
  originalSeverity: external_exports.string().nullable(),
  severityRank: external_exports.number().int().min(0).max(4),
  confidence: externalConfidenceSchema,
  confidenceLevel: external_exports.enum(CONFIDENCE_LEVELS),
  file: external_exports.string().nullable(),
  line: external_exports.number().int().positive().nullable(),
  column: external_exports.number().int().positive().nullable().optional(),
  evidence: external_exports.string().optional(),
  remediation: external_exports.string().optional(),
  action: agentActionSchema.nullable(),
  riskScore: external_exports.number().nullable(),
  cwe: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]).nullable(),
  owasp: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]).nullable(),
  verificationStatus: external_exports.custom(),
  metadata: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
});
function isExternalSecuritySourceTool(value) {
  return EXTERNAL_SECURITY_SOURCE_TOOLS.includes(value);
}

// features/security-analysis/normalize-external-finding.ts
var SEVERITY_MAP = {
  error: { severity: "HIGH", severityRank: 3 },
  ERROR: { severity: "HIGH", severityRank: 3 },
  warning: { severity: "MEDIUM", severityRank: 2 },
  WARNING: { severity: "MEDIUM", severityRank: 2 },
  info: { severity: "INFO", severityRank: 0 },
  INFO: { severity: "INFO", severityRank: 0 },
  CRITICAL: { severity: "CRITICAL", severityRank: 4 },
  critical: { severity: "CRITICAL", severityRank: 4 },
  LOW: { severity: "LOW", severityRank: 1 },
  low: { severity: "LOW", severityRank: 1 },
  HIGH: { severity: "HIGH", severityRank: 3 },
  high: { severity: "HIGH", severityRank: 3 },
  MEDIUM: { severity: "MEDIUM", severityRank: 2 },
  medium: { severity: "MEDIUM", severityRank: 2 }
};
var DEFAULT_SEVERITY = {
  severity: "MEDIUM",
  severityRank: 2
};
var RULE_CATEGORY_MAP = {
  injection: "injection",
  crypto: "crypto",
  auth: "auth",
  xss: "xss",
  ssrf: "ssrf",
  path: "path-traversal",
  deserialization: "deserialization",
  info: "info-exposure",
  permissions: "permissions",
  logging: "info-exposure",
  secrets: "secrets",
  prompt: "prompt-injection",
  prompt_injection_attempt: "prompt_injection_attempt",
  exfiltration: "exfiltration",
  supply: "supply-chain",
  command: "injection",
  sql: "injection"
};
var HEURISTIC_SOURCE_TOOLS2 = /* @__PURE__ */ new Set([
  "scan_agent_prompt",
  "scan_skill",
  "scan_agent_action"
]);
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}
function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function readNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function extractRuleId(finding) {
  return readString(finding.ruleId) ?? readString(finding.rule_id) ?? readString(finding.id) ?? readString(finding.rule);
}
function inferCategory(ruleId) {
  if (!ruleId) return null;
  const segments = ruleId.toLowerCase().split(".");
  for (const segment of segments) {
    if (RULE_CATEGORY_MAP[segment]) {
      return RULE_CATEGORY_MAP[segment];
    }
  }
  for (const segment of segments) {
    for (const [key, category] of Object.entries(RULE_CATEGORY_MAP)) {
      if (segment.includes(key)) {
        return category;
      }
    }
  }
  return null;
}
function normalizeExternalConfidence(confidence) {
  const upper = String(confidence ?? "MEDIUM").toUpperCase();
  if (upper === "HIGH" || upper === "MEDIUM" || upper === "LOW") {
    return upper;
  }
  return "MEDIUM";
}
function normalizeAction(action) {
  if (!action) return null;
  const upper = String(action).toUpperCase();
  if (upper === "BLOCK" || upper === "WARN" || upper === "ALLOW") {
    return upper;
  }
  if (upper === "LOG") {
    return "WARN";
  }
  return null;
}
function readMetadataField(finding, key) {
  const metadata = finding.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return metadata[key] ?? null;
}
function buildTitle(message, ruleId) {
  const trimmed = message.trim();
  if (!trimmed) {
    return ruleId;
  }
  const bracketMatch = trimmed.match(/^\[([^\]]+)\]/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }
  const firstLine = trimmed.split("\n")[0]?.trim() ?? trimmed;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}
function buildRemediation(finding) {
  const metadata = finding.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const fix = readString(metadata.fix);
    if (fix) return fix;
  }
  const suggestedFix = finding.suggested_fix;
  if (suggestedFix && typeof suggestedFix === "object" && !Array.isArray(suggestedFix)) {
    const description = readString(suggestedFix.description);
    if (description) return description;
  }
  return void 0;
}
function buildEvidence(finding) {
  return readString(finding.line_content) ?? readString(finding.matched_text) ?? readString(finding.contextNote) ?? void 0;
}
function resolveSourceTool(finding, sourceTool) {
  const perFinding = readString(finding.source_tool) ?? readString(finding.source);
  if (perFinding) {
    const normalized = perFinding.replace(/-/g, "_");
    if (normalized === "prompt_scanner") {
      return "scan_skill";
    }
    if (isExternalSecuritySourceTool(normalized)) {
      return normalized;
    }
  }
  return sourceTool;
}
function toSequraiRuleId(sourceTool, externalRuleId) {
  return `agent-scanner.${sourceTool}.${externalRuleId}`;
}
function normalizeExternalFinding(input, sourceTool, options = {}) {
  const finding = asRecord(input);
  if (!finding) {
    return null;
  }
  const externalRuleId = extractRuleId(finding) ?? "unknown";
  const resolvedSourceTool = resolveSourceTool(finding, sourceTool);
  const originalSeverity = readString(finding.severity);
  const mapped = originalSeverity && SEVERITY_MAP[originalSeverity] || DEFAULT_SEVERITY;
  const confidence = normalizeExternalConfidence(finding.confidence ?? readMetadataField(finding, "confidence"));
  const action = normalizeAction(finding.action);
  const message = readString(finding.message) ?? "";
  const category = readString(finding.category) ?? inferCategory(externalRuleId) ?? "general";
  const file2 = readString(finding.file);
  const lineValue = readNumber(finding.line);
  const line = lineValue != null && lineValue > 0 ? Math.trunc(lineValue) : null;
  const columnValue = readNumber(finding.column);
  const column = columnValue != null && columnValue > 0 ? Math.trunc(columnValue) : null;
  const verificationStatus = deriveInitialVerificationStatus({
    sourceTool: resolvedSourceTool,
    confidence,
    action
  });
  const confidenceLevel = deriveConfidenceLevel({
    legacyExternal: confidence,
    verificationStatus,
    llmOnly: HEURISTIC_SOURCE_TOOLS2.has(resolvedSourceTool)
  });
  const normalized = {
    scanner: AGENT_SECURITY_SCANNER_ID,
    sourceTool: resolvedSourceTool,
    ruleId: toSequraiRuleId(resolvedSourceTool, externalRuleId),
    externalRuleId,
    title: buildTitle(message, externalRuleId),
    description: message,
    message,
    category,
    severity: mapped.severity,
    originalSeverity,
    severityRank: mapped.severityRank,
    confidence,
    confidenceLevel,
    file: file2,
    line,
    column: column ?? null,
    evidence: buildEvidence(finding),
    remediation: buildRemediation(finding),
    action,
    riskScore: readNumber(finding.risk_score),
    cwe: finding.cwe ?? readMetadataField(finding, "cwe"),
    owasp: finding.owasp ?? readMetadataField(finding, "owasp"),
    verificationStatus,
    metadata: {
      securityAnalysis: {
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: resolvedSourceTool,
        externalRuleId,
        verificationStatus,
        confidenceLevel,
        originalSeverity,
        action,
        riskScore: readNumber(finding.risk_score)
      },
      ...options.includeRaw ? { externalRaw: finding } : {}
    }
  };
  return normalized;
}

// features/security-analysis/agent-action/to-findings.ts
function remediationFor(finding) {
  return AGENT_ACTION_CATEGORY_REMEDIATION[finding.category] ?? "Review this agent tool capability and apply least-privilege restrictions before production use.";
}
function agentActionRawFindingToSecurityAnalysis(finding) {
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: mapSeverityToExternal(finding.severity),
      category: finding.category,
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence: finding.confidence,
      action: finding.action,
      matched_text: finding.match,
      metadata: {
        fix: remediationFor(finding),
        agentActionTier: finding.tier,
        actionType: finding.actionType,
        toolName: finding.toolName
      }
    },
    AGENT_ACTION_SOURCE_TOOL
  );
  if (!normalized) return null;
  return {
    ...normalized,
    remediation: remediationFor(finding),
    metadata: {
      ...normalized.metadata ?? {},
      agentAction: {
        rule: finding.rule,
        category: finding.category,
        tier: finding.tier,
        actionType: finding.actionType,
        toolName: finding.toolName ?? null,
        match: finding.match ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: AGENT_ACTION_SOURCE_TOOL,
        confidence: finding.confidence,
        verificationStatus: normalized.verificationStatus,
        action: finding.action
      }
    }
  };
}
function agentActionRawFindingsToSecurityAnalysis(findings) {
  return findings.map(agentActionRawFindingToSecurityAnalysis).filter((finding) => finding != null);
}
function dedupeAgentSecurityFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.externalRuleId}|${finding.file ?? ""}|${finding.line ?? ""}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/to-finding-draft.ts
var SEVERITY_TO_SEQURAI = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info"
};
var CONFIDENCE_TO_SEQURAI = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
};
function mapVerificationToConfirmationStatus(status) {
  switch (status) {
    case "CONFIRMED":
      return "confirmed";
    case "LIKELY":
    case "POTENTIAL":
      return "potential_vulnerability";
    case "FALSE_POSITIVE":
    case "NOT_APPLICABLE":
      return "not_exploitable";
    case "NOT_REPRODUCED":
    case "UNVERIFIED":
    default:
      return "inconclusive";
  }
}
function verificationStatusLabel(status) {
  switch (status) {
    case "CONFIRMED":
      return "Confirmed \u2014 verified in this repository";
    case "LIKELY":
      return "Likely \u2014 strong signal, pending repository verification";
    case "POTENTIAL":
      return "Potential \u2014 static signal, not yet verified";
    case "UNVERIFIED":
      return "Unverified heuristic \u2014 do not treat as confirmed vulnerability";
    case "NOT_REPRODUCED":
      return "Not reproduced";
    case "FALSE_POSITIVE":
      return "False positive";
    case "NOT_APPLICABLE":
      return "Not applicable";
    default:
      return "Pending verification";
  }
}
function confidenceForTrustModel(finding) {
  if (finding.sourceTool === "scan_agent_prompt" || finding.sourceTool === "scan_skill") {
    return finding.confidence === "HIGH" ? "medium" : "low";
  }
  if (finding.sourceTool === "scan_agent_action") {
    return finding.action === "BLOCK" ? "medium" : "low";
  }
  if (finding.verificationStatus === "UNVERIFIED") {
    return "low";
  }
  return CONFIDENCE_TO_SEQURAI[finding.confidence];
}
function confidencePercentFromLevel(level) {
  switch (level) {
    case "VERIFIED":
      return 92;
    case "PROBABLE":
      return 78;
    case "INFERRED":
      return 62;
    default:
      return 35;
  }
}
function confidenceScoreFromLevel(level) {
  return confidencePercentFromLevel(level) / 100;
}
function defaultRemediation(finding) {
  if (finding.remediation?.trim()) {
    return finding.remediation.trim();
  }
  if (finding.action === "BLOCK") {
    return "Review and block this agent action in production workflows until the risk is understood and mitigated.";
  }
  return "Review this finding in context and apply a safe fix before shipping to production.";
}
function securityAnalysisFindingToDraft(finding) {
  const confidence = confidenceForTrustModel(finding);
  const reportConfidenceLevel = finding.confidenceLevel;
  const reportConfidenceBand = legacyBandFromConfidenceLevel(reportConfidenceLevel);
  const reportConfidenceScore = confidenceScoreFromLevel(reportConfidenceLevel);
  const confirmationStatus = mapVerificationToConfirmationStatus(finding.verificationStatus);
  const path = finding.file ?? "repository";
  const line = finding.line ?? 1;
  return {
    ruleId: finding.ruleId,
    title: finding.title,
    description: finding.description,
    severity: SEVERITY_TO_SEQURAI[finding.severity],
    confidence,
    category: finding.category ?? "general",
    location: {
      path,
      line,
      ...finding.column ? { column: finding.column } : {}
    },
    evidence: finding.evidence,
    remediation: defaultRemediation(finding),
    fingerprintMaterial: `${finding.externalRuleId}:${finding.message}:${finding.file ?? ""}:${finding.line ?? ""}`,
    metadata: {
      ...finding.metadata ?? {},
      ...finding.metadata?.diffContext ? { diffContext: finding.metadata.diffContext } : {},
      securityAnalysis: {
        ...finding.metadata?.securityAnalysis,
        verificationStatus: finding.verificationStatus,
        sourceTool: finding.sourceTool,
        scanner: finding.scanner,
        externalRuleId: finding.externalRuleId,
        action: finding.action,
        cwe: finding.cwe,
        owasp: finding.owasp,
        riskScore: finding.riskScore
      },
      evidenceReport: {
        version: 1,
        detectionMethod: "STATIC_ANALYSIS",
        confidence: reportConfidenceScore,
        confidenceLevel: reportConfidenceLevel,
        confidencePercent: confidencePercentFromLevel(reportConfidenceLevel),
        confidenceExplanation: finding.verificationStatus === "UNVERIFIED" ? "Heuristic scanner signal \u2014 requires repository verification before affecting Production Verdict as confirmed." : reportConfidenceBand === "high" ? "External security engine signal \u2014 SequrAI will verify before treating as production-blocking." : "External scanner signal with limited structural verification.",
        falsePositiveProbability: finding.verificationStatus === "UNVERIFIED" ? 0.55 : 0.25,
        falsePositivePercent: finding.verificationStatus === "UNVERIFIED" ? 55 : 25,
        falsePositiveExplanation: "External scanner findings can be noisy until correlated with repository context and verification.",
        confirmationStatus,
        statusLabel: verificationStatusLabel(finding.verificationStatus),
        evidence: finding.evidence ? [
          {
            id: "external-scanner-evidence",
            kind: "scanner_match",
            label: "External scanner evidence",
            detail: finding.evidence
          }
        ] : [],
        counterEvidence: [],
        reasoning: finding.description,
        affectedFiles: [{ path, line, matchedRule: finding.ruleId }],
        matchedRules: [
          {
            ruleId: finding.ruleId,
            ruleName: finding.title,
            category: finding.category ?? "general",
            ...finding.cwe ? { cwe: Array.isArray(finding.cwe) ? finding.cwe : [finding.cwe] } : {},
            ...finding.owasp ? { owasp: Array.isArray(finding.owasp) ? finding.owasp : [finding.owasp] } : {}
          }
        ],
        verificationStatus: finding.verificationStatus,
        recommendedFix: defaultRemediation(finding)
      }
    }
  };
}
function securityAnalysisFindingsToDrafts(findings) {
  return findings.map(securityAnalysisFindingToDraft);
}

// features/security-analysis/rules/agent-action-rule.ts
function analyzeAgentActionSecurity(files) {
  const scan = scanAgentActionRepository(files);
  const findings = dedupeAgentSecurityFindings(
    agentActionRawFindingsToSecurityAnalysis(scan.findings)
  );
  return { scan, findings };
}
var agentActionRule = {
  id: AGENT_ACTION_RULE_ID,
  title: "Agent action security analysis",
  run: ({ files }) => {
    const repositoryFiles = files.map((file2) => ({
      path: file2.path,
      content: file2.content
    }));
    const { findings } = analyzeAgentActionSecurity(repositoryFiles);
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  }
};

// features/security-analysis/mcp/constants.ts
var MCP_SCANNABLE_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".ts", ".py"]);
var MCP_SKIP_DIR_SEGMENTS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "venv",
  "env",
  ".venv",
  "coverage",
  ".next",
  ".nuxt"
]);
var MCP_MANIFEST_FILENAME = "server.json";
var MCP_BASELINE_FILENAME = ".mcp-security-baseline.json";
var MCP_CONTENT_INDICATORS = [
  /@modelcontextprotocol/,
  /from\s+['"]@modelcontextprotocol/,
  /server\.tool\s*\(/,
  /\bMcpServer\b/,
  /\bcreateMcpServer\b/,
  /\.registerTool\s*\(/,
  /\bmcp\.server\b/i
];
var MANIFEST_INJECTION_PHRASES = /ignore\s+previous|exfiltrat|override\s+.*instruction|do\s+not\s+tell|hidden\s+instruction|bypass\s+.*filter|disregard\s+|extract\s+.*credential/i;
var MANIFEST_ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF\u2060]/;
var MANIFEST_BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/;
var SUSPICIOUS_DEFAULT = /\b(curl|wget|nc|bash|sh|powershell|cmd)\b.*[|>]|https?:\/\/[^\s'"]+|ignore\s+previous|exfiltrat|override\s+.*instruction|do\s+not\s+tell|hidden\s+instruction|bypass\s+.*filter/i;
var URL_IN_DESCRIPTION = /https?:\/\/[^\s'"<>]+/gi;
var SAFE_URL_DOMAINS = /^https?:\/\/(github\.com|npmjs\.com|pypi\.org|docs\.|api\.)/i;
var TUNNELING_URL = /https?:\/\/[^\s'"]*\b(ngrok|serveo|localtunnel|localhost|127\.0\.0\.1|webhook\.site|requestbin|pipedream|interact\.sh|burp|oast)\b/i;
var PRIORITY_PATTERNS = /\b(before\s+calling\s+any\s+other\s+tool|do\s+not\s+use\s+any\s+other\s+tool|replaces?\s+the\s+function\s+of|must\s+be\s+(called|used|run|invoked)\s+(first|before)|always\s+(call|use|run|invoke)\s+this\s+(first|before)|instead\s+of\s+(using|calling))\b/i;
var MCP_SECURITY_RULE_ID = "mcp.security";
var MCP_SECURITY_SOURCE_TOOL = "scan_mcp_server";

// features/security-analysis/mcp/discover.ts
function basename2(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
function dirname(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}
function extension(path) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}
var DETECTOR_SOURCE_PATH = /(?:^|\/)features\/security-analysis\/mcp\//i;
var FIRST_PARTY_MCP_IMPLEMENTATION_PATH = /(?:^|\/)server\/mcp\//i;
function shouldSkipMcpPath(path) {
  if (DETECTOR_SOURCE_PATH.test(path) || FIRST_PARTY_MCP_IMPLEMENTATION_PATH.test(path)) {
    return true;
  }
  return path.split("/").some((segment) => MCP_SKIP_DIR_SEGMENTS.has(segment));
}
function isScannableSource(path) {
  return MCP_SCANNABLE_EXTENSIONS.has(extension(path));
}
function isMcpRelatedPath(path) {
  return /(?:^|\/)mcp(?:\/|$)/i.test(path) || /mcp-server/i.test(path);
}
function hasMcpServerContent(content) {
  return MCP_CONTENT_INDICATORS.some((pattern) => pattern.test(content));
}
function discoverMcpTargets(files) {
  const sourceFiles = [];
  const manifestFiles = [];
  const baselineFiles = [];
  const manifestDirs = /* @__PURE__ */ new Set();
  const seenSourcePaths = /* @__PURE__ */ new Set();
  for (const file2 of files) {
    if (shouldSkipMcpPath(file2.path)) continue;
    const name = basename2(file2.path);
    if (name === MCP_MANIFEST_FILENAME) {
      manifestFiles.push(file2);
      manifestDirs.add(dirname(file2.path));
    }
    if (name === MCP_BASELINE_FILENAME) {
      baselineFiles.push(file2);
    }
  }
  for (const file2 of files) {
    if (shouldSkipMcpPath(file2.path)) continue;
    if (!isScannableSource(file2.path)) continue;
    const dir = dirname(file2.path);
    const nearManifest = manifestDirs.has(dir);
    const mcpPath = isMcpRelatedPath(file2.path);
    const mcpContent = hasMcpServerContent(file2.content);
    if (nearManifest || mcpPath || mcpContent) {
      if (!seenSourcePaths.has(file2.path)) {
        seenSourcePaths.add(file2.path);
        sourceFiles.push(file2);
      }
    }
  }
  return { sourceFiles, manifestFiles, baselineFiles };
}
function findBaselineForManifest(manifestPath, baselineFiles) {
  const dir = dirname(manifestPath);
  return baselineFiles.find((file2) => dirname(file2.path) === dir);
}

// features/security-analysis/mcp/spoofing.ts
var KNOWN_MCP_TOOLS = /* @__PURE__ */ new Set([
  "readFile",
  "writeFile",
  "editFile",
  "createFile",
  "deleteFile",
  "listDirectory",
  "makeDirectory",
  "moveFile",
  "copyFile",
  "readMultipleFiles",
  "listFiles",
  "bash",
  "execute",
  "runCommand",
  "runScript",
  "search",
  "grep",
  "find",
  "glob",
  "fetch",
  "browse",
  "webSearch",
  "httpRequest",
  "gitStatus",
  "gitDiff",
  "gitCommit",
  "gitLog",
  "gitAdd",
  "remember",
  "recall",
  "storeMemory",
  "searchMemory",
  "query",
  "executeQuery",
  "dbQuery",
  "think",
  "plan",
  "summarize",
  "analyze"
]);
function levenshtein(a, b) {
  if (a.length > 100 || b.length > 100) return 999;
  const m = a.length;
  const n = b.length;
  const dp = Array.from(
    { length: m + 1 },
    (_, i) => Array.from({ length: n + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function findSpoofedTool(toolName) {
  if (KNOWN_MCP_TOOLS.has(toolName)) return null;
  if (toolName.length < 6) return null;
  let best = null;
  let bestDist = 3;
  for (const known of KNOWN_MCP_TOOLS) {
    if (Math.abs(known.length - toolName.length) > 2) continue;
    const distance = levenshtein(toolName, known);
    if (distance < bestDist) {
      bestDist = distance;
      best = known;
    }
  }
  return best ? { spoofed: best, distance: bestDist } : null;
}

// features/security-analysis/mcp/rules.ts
var MCP_SECURITY_RULES = [
  {
    id: "mcp.shell-exec-no-validation",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message: "Shell command execution without input validation. User-controlled input may reach exec/execSync, enabling arbitrary command execution.",
    pattern: /\b(exec|execSync)\s*\(\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+|[a-zA-Z_$][\w$]*(\s*\+|\s*,\s*\{[^}]*shell\s*:\s*true))/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.shell-exec-direct",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message: "Direct use of exec/execSync with potential string concatenation. Prefer execFile/execFileSync with explicit argument arrays and shell:false.",
    pattern: /\bchild_process\b.*\b(exec|execSync)\b|(?<!\.)\b(exec|execSync)\s*\(/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.spawn-shell-true",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message: "spawn/spawnSync called with shell:true, allowing shell injection. Use shell:false and pass arguments as an array.",
    pattern: /\b(spawn|spawnSync)\s*\([^)]*\{[^}]*shell\s*:\s*true/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.subprocess-shell",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message: "subprocess called with shell=True, allowing shell injection. Use shell=False with a command list.",
    pattern: /subprocess\.(run|call|Popen|check_output|check_call)\s*\([^)]*shell\s*=\s*True/g,
    fileTypes: [".py"]
  },
  {
    id: "mcp.os-system",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message: "os.system() executes commands through the shell. Use subprocess with shell=False instead.",
    pattern: /\bos\.system\s*\(/g,
    fileTypes: [".py"]
  },
  {
    id: "mcp.fs-write-no-path-validation",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message: "Filesystem write operation without visible path validation. Ensure paths are validated with path.resolve and confined to an allowed directory.",
    pattern: /\b(writeFileSync|writeFile|createWriteStream|appendFileSync|appendFile)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*(?:path\.resolve|path\.join|path\.normalize))/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.http-request-user-url",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message: "HTTP request to a potentially user-controlled URL. Validate and allowlist target URLs to prevent SSRF.",
    pattern: /\b(fetch|axios\.(get|post|put|delete|request)|http\.request|https\.request|got|request)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*['"`])/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.env-var-exposure",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message: "Environment variables accessed and potentially exposed in tool output. Ensure secrets are not leaked through MCP responses.",
    pattern: /process\.env\b/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.env-var-exposure-python",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message: "Environment variables accessed and potentially exposed in tool output. Ensure secrets are not leaked through MCP responses.",
    pattern: /os\.environ\b|os\.getenv\s*\(/g,
    fileTypes: [".py"]
  },
  {
    id: "mcp.no-input-validation",
    severity: "WARNING",
    category: "missing-input-validation",
    message: "Tool handler accepts string input without visible validation or sanitization. Use zod, joi, or manual validation to constrain inputs.",
    pattern: /\.tool\s*\(\s*["'][^"']+["']\s*,\s*["'][^"']*["']\s*,\s*\{[^}]*\}\s*,\s*(async\s+)?\(\s*\{/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines, lineIndex) => {
      const lookahead = lines.slice(lineIndex, lineIndex + 15).join("\n");
      const hasValidation = /\b(z\.|zod\.|joi\.|validate|sanitize|schema|\.parse\(|\.safeParse\(|isValid|assert|check)\b/i.test(
        lookahead
      );
      return !hasValidation;
    }
  },
  {
    id: "mcp.path-no-normalize",
    severity: "WARNING",
    category: "missing-input-validation",
    message: "File path used without normalization. Use path.resolve() or path.normalize() to prevent path traversal attacks.",
    pattern: /\b(readFileSync|readFile|existsSync|statSync|stat|unlink|unlinkSync|rmdir|rmdirSync|mkdir|mkdirSync)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*(?:path\.|resolve|normalize))/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines, lineIndex) => {
      const context = lines.slice(Math.max(0, lineIndex - 5), lineIndex + 1).join("\n");
      return !/path\.(resolve|normalize|join)\s*\(/.test(context);
    }
  },
  {
    id: "mcp.url-no-validation",
    severity: "WARNING",
    category: "missing-input-validation",
    message: "URL used without validation. Validate URL scheme and host to prevent SSRF and open redirect vulnerabilities.",
    // Parsing the framework's own incoming request URL (request.url /
    // req.url / request.nextUrl) is a standard, safe idiom, not an
    // outbound-destination SSRF risk — exclude it explicitly.
    pattern: /new\s+URL\s*\(\s*(?!(?:request|req)\.(?:url|nextUrl)\b)[a-zA-Z_$][\w$.]*\s*\)|url\.parse\s*\(\s*(?!(?:request|req)\.(?:url|nextUrl)\b)[a-zA-Z_$][\w$.]*\s*\)/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines, lineIndex) => {
      const lookahead = lines.slice(lineIndex, lineIndex + 5).join("\n");
      return !/\.(hostname|host|protocol|origin)\s*(===|!==|==|!=)|allowlist|whitelist|allowed/i.test(
        lookahead
      );
    }
  },
  {
    id: "mcp.exfiltration-external-request",
    severity: "ERROR",
    category: "data-exfiltration",
    message: "Data sent to an external URL. MCP servers should not exfiltrate data to third-party endpoints without explicit user consent.",
    pattern: /\b(fetch|axios\.(post|put|patch)|http\.request|https\.request)\s*\(\s*['"`](https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[^'"` ]+)['"`]/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.exfiltration-external-request-python",
    severity: "ERROR",
    category: "data-exfiltration",
    message: "Data sent to an external URL. MCP servers should not exfiltrate data to third-party endpoints without explicit user consent.",
    pattern: /\b(requests\.(post|put|patch)|urllib\.request\.urlopen|httpx\.(post|put|patch))\s*\(\s*['"`](https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[^'"` ]+)['"`]/g,
    fileTypes: [".py"]
  },
  {
    id: "mcp.exfiltration-network-socket",
    severity: "WARNING",
    category: "data-exfiltration",
    message: "Network socket created. Verify this is not used to exfiltrate data to external hosts.",
    pattern: /\bnet\.(createConnection|connect|Socket)\s*\(|new\s+WebSocket\s*\(/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.exfiltration-log-secrets",
    severity: "WARNING",
    category: "data-exfiltration",
    message: "Potentially sensitive data (keys, tokens, passwords) logged or printed. This may leak secrets through MCP server stderr.",
    pattern: /\b(console\.(log|error|warn|info)|print|logging\.(info|warning|error|debug))\s*\([^)]*\b(key|token|password|secret|credential|api_key|apiKey|auth|bearer)\b/gi,
    fileTypes: [".js", ".ts", ".py"]
  },
  {
    id: "mcp.eval-usage",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "eval() executes arbitrary code. Never use eval with user-controlled input in an MCP server.",
    pattern: /\beval\s*\(/g,
    fileTypes: [".js", ".ts", ".py"]
  },
  {
    id: "mcp.function-constructor",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "new Function() is equivalent to eval(). Avoid constructing functions from strings.",
    pattern: /new\s+Function\s*\(/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.exec-string-concat",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "child_process.exec() with string concatenation is vulnerable to command injection. Use execFile() with argument arrays.",
    pattern: /\bexec\s*\(\s*['"`][^'"`]*['"`]\s*\+/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.cors-wildcard",
    severity: "WARNING",
    category: "insecure-patterns",
    message: "CORS configured with wildcard origin (*). This allows any website to interact with the MCP server.",
    pattern: /cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.cors-permissive",
    severity: "INFO",
    category: "insecure-patterns",
    message: "CORS enabled. Verify the origin configuration is appropriately restrictive.",
    pattern: /\bcors\s*\(\s*\)/g,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.no-auth-check",
    severity: "INFO",
    category: "insecure-patterns",
    message: "No authentication or authorization checks detected. If this MCP server is network-accessible, add authentication.",
    pattern: /\b(createServer|listen)\s*\(/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines) => {
      const fullSource = lines.join("\n");
      return !/\b(auth|authenticate|authorize|jwt|bearer|token|apiKey|api_key|session|passport)\b/i.test(
        fullSource
      );
    }
  },
  {
    id: "mcp.pickle-load",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "pickle.load/loads deserializes arbitrary Python objects. This can execute arbitrary code if the input is attacker-controlled.",
    pattern: /\bpickle\.(load|loads)\s*\(/g,
    fileTypes: [".py"]
  },
  {
    id: "mcp.yaml-unsafe-load",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "yaml.load() without SafeLoader can execute arbitrary Python. Use yaml.safe_load() instead.",
    pattern: /\byaml\.load\s*\([^)]*(?!Loader\s*=\s*yaml\.SafeLoader)/g,
    fileTypes: [".py"]
  },
  {
    id: "mcp.unicode-zero-width",
    severity: "ERROR",
    category: "unicode-poisoning",
    message: "Zero-width or invisible Unicode character detected in source. This is a common technique to hide injected instructions in tool descriptions.",
    pattern: /[\u200B\u200C\u200D\uFEFF\u2060]/g,
    fileTypes: [".js", ".ts", ".py"]
  },
  {
    id: "mcp.unicode-bidi-override",
    severity: "ERROR",
    category: "unicode-poisoning",
    message: "Bidirectional text override character detected. Attackers use these to make malicious code appear differently in editors vs. execution.",
    pattern: /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g,
    fileTypes: [".js", ".ts", ".py"]
  },
  {
    id: "mcp.unicode-homoglyph",
    severity: "WARNING",
    category: "unicode-poisoning",
    message: "Cyrillic character found adjacent to ASCII characters. This is a common homoglyph substitution pattern used in tool name spoofing attacks.",
    pattern: /[a-zA-Z][\u0400-\u04FF]|[\u0400-\u04FF][a-zA-Z]/g,
    fileTypes: [".js", ".ts", ".py"]
  },
  {
    id: "mcp.description-injection",
    severity: "ERROR",
    category: "description-injection",
    message: "Tool description contains imperative language directed at the LLM. This pattern is used in tool poisoning attacks to inject hidden instructions.",
    pattern: /server\.tool\s*\(\s*["'`][^"'`]*["'`]\s*,\s*["'`][^"'`]*(ignore\s+previous|exfiltrat|override\s+.*instruction|do\s+not\s+tell|hidden\s+instruction|bypass\s+.*filter|disregard\s+|extract\s+.*credential)[^"'`]*["'`]/gi,
    fileTypes: [".js", ".ts"]
  },
  {
    id: "mcp.tool-name-spoofing",
    severity: "ERROR",
    category: "tool-name-spoofing",
    message: "Tool name is suspiciously similar to a well-known MCP tool. This may be a name spoofing attack.",
    pattern: /server\.tool\s*\(\s*["'`]([a-zA-Z_$][\w$]*)["'`]/g,
    fileTypes: [".js", ".ts"],
    isSpoofingRule: true
  }
];
var MCP_CATEGORY_REMEDIATION = {
  "overly-broad-permissions": "Replace shell execution with argument-array APIs, validate file paths, and avoid exposing environment variables in MCP tool responses.",
  "missing-input-validation": "Add schema validation for all MCP tool inputs using zod or equivalent validators.",
  "data-exfiltration": "Audit outbound network calls and remove logging of secrets from MCP server output.",
  "insecure-patterns": "Remove eval/Function usage, tighten CORS, and add authentication for network-accessible MCP servers.",
  "unicode-poisoning": "Remove hidden Unicode characters from tool names and descriptions.",
  "description-injection": "Rewrite tool descriptions to describe functionality only \u2014 remove LLM-directed instructions.",
  "tool-name-spoofing": "Verify tool names are intentional and do not mimic well-known MCP tools.",
  "schema-manipulation": "Inspect inputSchema metadata for hidden instructions, suspicious defaults, or open additionalProperties.",
  "cross-tool-manipulation": "Remove cross-tool priority directives from tool descriptions.",
  "rug-pull": "Compare MCP tool definitions against a trusted baseline before approving changes.",
  manifest: "Fix malformed MCP manifest JSON before deploying the server."
};

// features/security-analysis/mcp/scan-file.ts
function extensionForPath(path) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}
function scanMcpFileContent(filePath, content) {
  const ext = extensionForPath(filePath);
  const lines = content.split("\n");
  const findings = [];
  for (const rule of MCP_SECURITY_RULES) {
    if (!rule.fileTypes.includes(ext)) continue;
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const upToMatch = content.slice(0, match.index);
      const lineNumber = upToMatch.split("\n").length;
      const lineIndex = lineNumber - 1;
      if (rule.contextCheck) {
        const line = lines[lineIndex] ?? "";
        if (!rule.contextCheck(line, lines, lineIndex)) {
          continue;
        }
      }
      if (rule.isSpoofingRule) {
        const toolName = match[1];
        if (!toolName) continue;
        const spoof = findSpoofedTool(toolName);
        if (!spoof) continue;
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: `Tool name "${toolName}" is ${spoof.distance} edit(s) away from well-known tool "${spoof.spoofed}". This may be a spoofing attack.`,
          file: filePath,
          line: lineNumber,
          match: match[0].slice(0, 100)
        });
        continue;
      }
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        category: rule.category,
        message: rule.message,
        file: filePath,
        line: lineNumber,
        match: match[0].slice(0, 100)
      });
    }
  }
  return findings;
}
function dedupeMcpFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.rule}:${finding.file}:${finding.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/mcp/scan-manifest.ts
import { createHash } from "node:crypto";
function escapeRegex2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hashTool(tool) {
  return createHash("sha256").update(JSON.stringify({ name: tool.name, description: tool.description })).digest("hex");
}
function checkSchemaManipulation(tool, manifestPath) {
  const findings = [];
  const name = tool.name ?? "";
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== "object") return findings;
  const properties = schema.properties ?? {};
  if (schema.additionalProperties === true && Object.keys(properties).length === 0) {
    findings.push({
      rule: "mcp.schema-open-additionalProperties",
      severity: "WARNING",
      category: "schema-manipulation",
      message: `Tool "${name}" has additionalProperties:true with no defined properties \u2014 accepts arbitrary hidden parameters.`,
      file: manifestPath,
      line: 1,
      match: name
    });
  }
  for (const [propName, propDef] of Object.entries(properties)) {
    if (!propDef || typeof propDef !== "object") continue;
    const desc = propDef.description ?? "";
    const defaultVal = propDef.default !== void 0 ? String(propDef.default) : "";
    const enumValues = Array.isArray(propDef.enum) ? propDef.enum.map(String) : [];
    if (desc && (MANIFEST_INJECTION_PHRASES.test(desc) || MANIFEST_ZERO_WIDTH.test(desc) || MANIFEST_BIDI.test(desc))) {
      findings.push({
        rule: "mcp.schema-description-injection",
        severity: "ERROR",
        category: "schema-manipulation",
        message: `Tool "${name}" property "${propName}" description contains injection language or hidden characters.`,
        file: manifestPath,
        line: 1,
        match: desc.slice(0, 100)
      });
    }
    if (defaultVal && SUSPICIOUS_DEFAULT.test(defaultVal)) {
      findings.push({
        rule: "mcp.schema-suspicious-default",
        severity: "ERROR",
        category: "schema-manipulation",
        message: `Tool "${name}" property "${propName}" has a suspicious default value containing shell commands, URLs, or injection patterns.`,
        file: manifestPath,
        line: 1,
        match: defaultVal.slice(0, 100)
      });
    }
    for (const val of enumValues) {
      if (MANIFEST_INJECTION_PHRASES.test(val) || SUSPICIOUS_DEFAULT.test(val)) {
        findings.push({
          rule: "mcp.schema-suspicious-default",
          severity: "ERROR",
          category: "schema-manipulation",
          message: `Tool "${name}" property "${propName}" has a suspicious enum value.`,
          file: manifestPath,
          line: 1,
          match: val.slice(0, 100)
        });
        break;
      }
    }
  }
  return findings;
}
function checkCrossToolManipulation(tools, manifestPath) {
  const findings = [];
  const toolNames = new Set(tools.map((tool) => (tool.name ?? "").toLowerCase()).filter(Boolean));
  for (const tool of tools) {
    const name = tool.name ?? "";
    const description = tool.description ?? "";
    if (!description) continue;
    for (const otherName of toolNames) {
      if (otherName === name.toLowerCase()) continue;
      const escaped = escapeRegex2(otherName);
      const refPattern1 = new RegExp(
        `\\b(before\\s+using|always\\s+(call|use|run|invoke)|after\\s+calling|instead\\s+of)\\s+\\w*${escaped}\\b`,
        "i"
      );
      const refPattern2 = new RegExp(
        `\\b(call|use|invoke|run|execute|trigger)\\s+\\w*${escaped}\\b.*\\b(first|before|always)\\b`,
        "i"
      );
      if (refPattern1.test(description) || refPattern2.test(description)) {
        findings.push({
          rule: "mcp.cross-tool-reference",
          severity: "ERROR",
          category: "cross-tool-manipulation",
          message: `Tool "${name}" description contains action directive referencing tool "${otherName}". This may be a cross-tool manipulation attack.`,
          file: manifestPath,
          line: 1,
          match: description.slice(0, 100)
        });
        break;
      }
    }
    if (PRIORITY_PATTERNS.test(description)) {
      findings.push({
        rule: "mcp.cross-tool-priority-override",
        severity: "ERROR",
        category: "cross-tool-manipulation",
        message: `Tool "${name}" description demands execution priority or exclusivity over other tools.`,
        file: manifestPath,
        line: 1,
        match: description.slice(0, 100)
      });
    }
  }
  return findings;
}
function scanMcpManifest(manifestPath, content) {
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch {
    return [
      {
        rule: "mcp.manifest-parse-error",
        severity: "WARNING",
        category: "manifest",
        message: "server.json is not valid JSON.",
        file: manifestPath,
        line: 1,
        match: ""
      }
    ];
  }
  const findings = [];
  const tools = manifest.tools ?? [];
  for (const tool of tools) {
    const name = tool.name ?? "";
    const description = tool.description ?? "";
    if (MANIFEST_ZERO_WIDTH.test(description) || MANIFEST_ZERO_WIDTH.test(name)) {
      findings.push({
        rule: "mcp.unicode-zero-width",
        severity: "ERROR",
        category: "unicode-poisoning",
        message: "Zero-width Unicode character in manifest tool name or description.",
        file: manifestPath,
        line: 1,
        match: name
      });
    }
    if (MANIFEST_BIDI.test(description) || MANIFEST_BIDI.test(name)) {
      findings.push({
        rule: "mcp.unicode-bidi-override",
        severity: "ERROR",
        category: "unicode-poisoning",
        message: "Bidirectional override character in manifest tool name or description.",
        file: manifestPath,
        line: 1,
        match: name
      });
    }
    if (MANIFEST_INJECTION_PHRASES.test(description)) {
      findings.push({
        rule: "mcp.manifest-description-injection",
        severity: "ERROR",
        category: "description-injection",
        message: `Tool "${name}" description contains injection language. Likely tool poisoning.`,
        file: manifestPath,
        line: 1,
        match: description.slice(0, 100)
      });
    }
    if (name) {
      const spoof = findSpoofedTool(name);
      if (spoof) {
        findings.push({
          rule: "mcp.manifest-name-spoofing",
          severity: "ERROR",
          category: "tool-name-spoofing",
          message: `Manifest tool name "${name}" is ${spoof.distance} edit(s) away from well-known tool "${spoof.spoofed}".`,
          file: manifestPath,
          line: 1,
          match: name
        });
      }
    }
    if (description.length > 500) {
      findings.push({
        rule: "mcp.manifest-description-too-long",
        severity: "WARNING",
        category: "description-injection",
        message: `Tool "${name}" description is ${description.length} chars \u2014 unusually long descriptions often contain hidden instructions.`,
        file: manifestPath,
        line: 1,
        match: description.slice(0, 100)
      });
    }
    findings.push(...checkSchemaManipulation(tool, manifestPath));
    const urls = description.match(URL_IN_DESCRIPTION);
    if (urls) {
      for (const url2 of urls) {
        if (TUNNELING_URL.test(url2)) {
          findings.push({
            rule: "mcp.description-tunneling-url",
            severity: "ERROR",
            category: "description-injection",
            message: `Tool "${name}" description contains a dev/tunneling URL.`,
            file: manifestPath,
            line: 1,
            match: url2.slice(0, 100)
          });
        } else if (!SAFE_URL_DOMAINS.test(url2)) {
          findings.push({
            rule: "mcp.description-suspicious-url",
            severity: "WARNING",
            category: "description-injection",
            message: `Tool "${name}" description contains an external URL that the LLM might follow.`,
            file: manifestPath,
            line: 1,
            match: url2.slice(0, 100)
          });
        }
      }
    }
  }
  findings.push(...checkCrossToolManipulation(tools, manifestPath));
  if (tools.length >= 5) {
    const lengths = tools.map((tool) => (tool.description ?? "").length);
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const stddev = Math.sqrt(
      lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length
    );
    if (stddev > 0) {
      for (const tool of tools) {
        const len = (tool.description ?? "").length;
        const zScore = (len - mean) / stddev;
        if (zScore > 2.5) {
          findings.push({
            rule: "mcp.description-length-anomaly",
            severity: "WARNING",
            category: "description-injection",
            message: `Tool "${tool.name}" description length (${len} chars) is a statistical outlier (z-score: ${zScore.toFixed(1)}).`,
            file: manifestPath,
            line: 1,
            match: (tool.description ?? "").slice(0, 100)
          });
        }
      }
    }
  }
  return findings;
}
function checkMcpRugPull(manifestPath, manifestContent, baselineContent) {
  if (!baselineContent) return [];
  let baseline;
  let manifest;
  try {
    baseline = JSON.parse(baselineContent);
    manifest = JSON.parse(manifestContent);
  } catch {
    return [];
  }
  const current = {};
  for (const tool of manifest.tools ?? []) {
    if (tool.name) {
      current[tool.name] = hashTool(tool);
    }
  }
  const baselineHashes = baseline.tools ?? {};
  const findings = [];
  for (const [name, hash2] of Object.entries(current)) {
    if (!baselineHashes[name]) {
      findings.push({
        rule: "mcp.rug-pull-detected",
        severity: "ERROR",
        category: "rug-pull",
        message: `New tool "${name}" appeared since baseline was recorded. Verify this addition is intentional.`,
        file: manifestPath,
        line: 1,
        match: name
      });
    } else if (baselineHashes[name] !== hash2) {
      findings.push({
        rule: "mcp.rug-pull-detected",
        severity: "ERROR",
        category: "rug-pull",
        message: `Tool "${name}" schema/description changed since baseline. Rug pull indicator \u2014 verify the change is intentional.`,
        file: manifestPath,
        line: 1,
        match: name
      });
    }
  }
  for (const name of Object.keys(baselineHashes)) {
    if (!current[name]) {
      findings.push({
        rule: "mcp.rug-pull-detected",
        severity: "ERROR",
        category: "rug-pull",
        message: `Tool "${name}" was removed since baseline was recorded. Verify this removal is intentional.`,
        file: manifestPath,
        line: 1,
        match: name
      });
    }
  }
  return findings;
}

// features/security-analysis/mcp/scan-repository.ts
function scanMcpRepository(files) {
  const targets = discoverMcpTargets(files);
  const findings = [];
  for (const file2 of targets.sourceFiles) {
    findings.push(...scanMcpFileContent(file2.path, file2.content));
  }
  for (const manifest of targets.manifestFiles) {
    findings.push(...scanMcpManifest(manifest.path, manifest.content));
    const baseline = findBaselineForManifest(manifest.path, targets.baselineFiles);
    if (baseline) {
      findings.push(
        ...checkMcpRugPull(manifest.path, manifest.content, baseline.content)
      );
    }
  }
  const deduped = dedupeMcpFindings(findings);
  const severityOrder = { ERROR: 0, WARNING: 1, INFO: 2 };
  deduped.sort(
    (left, right) => (severityOrder[left.severity] ?? 2) - (severityOrder[right.severity] ?? 2)
  );
  return {
    targets,
    findings: deduped,
    filesScanned: targets.sourceFiles.length + targets.manifestFiles.length
  };
}

// features/security-analysis/mcp/to-findings.ts
function severityToConfidence2(severity) {
  switch (severity) {
    case "ERROR":
      return "HIGH";
    case "WARNING":
      return "MEDIUM";
    default:
      return "LOW";
  }
}
function mapCategory(category) {
  switch (category) {
    case "overly-broad-permissions":
    case "missing-input-validation":
      return "permissions";
    case "data-exfiltration":
      return "exfiltration";
    case "description-injection":
    case "unicode-poisoning":
    case "tool-name-spoofing":
    case "schema-manipulation":
    case "cross-tool-manipulation":
    case "rug-pull":
      return "supply-chain";
    case "insecure-patterns":
      return "injection";
    default:
      return category;
  }
}
function mcpRawFindingToSecurityAnalysis(finding) {
  const confidence = severityToConfidence2(finding.severity);
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: finding.severity,
      category: mapCategory(finding.category),
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence,
      line_content: finding.match,
      metadata: {
        fix: MCP_CATEGORY_REMEDIATION[finding.category],
        mcpCategory: finding.category
      }
    },
    MCP_SECURITY_SOURCE_TOOL
  );
  if (!normalized) return null;
  return {
    ...normalized,
    metadata: {
      ...normalized.metadata ?? {},
      mcp: {
        rule: finding.rule,
        category: finding.category,
        match: finding.match ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: MCP_SECURITY_SOURCE_TOOL,
        confidence,
        verificationStatus: normalized.verificationStatus
      }
    }
  };
}
function mcpRawFindingsToSecurityAnalysis(findings) {
  return findings.map(mcpRawFindingToSecurityAnalysis).filter((finding) => finding != null);
}
function dedupeMcpSecurityFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.externalRuleId}|${finding.file ?? ""}|${finding.line ?? ""}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/rules/mcp-security-rule.ts
function analyzeMcpSecurity(files) {
  const scan = scanMcpRepository(files);
  const findings = dedupeMcpSecurityFindings(mcpRawFindingsToSecurityAnalysis(scan.findings));
  return { scan, findings };
}
var mcpSecurityRule = {
  id: MCP_SECURITY_RULE_ID,
  title: "MCP server security analysis",
  run: ({ files }) => {
    const repositoryFiles = files.map((file2) => ({
      path: file2.path,
      content: file2.content
    }));
    const { findings } = analyzeMcpSecurity(repositoryFiles);
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  }
};

// features/security-analysis/package-security/typosquat.ts
var TOP_PACKAGES = {
  npm: [
    "express",
    "react",
    "lodash",
    "axios",
    "chalk",
    "commander",
    "debug",
    "moment",
    "uuid",
    "semver",
    "webpack",
    "typescript",
    "eslint",
    "jest",
    "prettier",
    "next",
    "dotenv",
    "mongoose",
    "socket.io",
    "jsonwebtoken",
    "bcrypt",
    "nodemon"
  ],
  pypi: [
    "requests",
    "flask",
    "django",
    "numpy",
    "pandas",
    "boto3",
    "setuptools",
    "pip",
    "pyyaml",
    "cryptography",
    "pytest",
    "fastapi",
    "pydantic",
    "httpx",
    "black",
    "tensorflow",
    "scikit-learn"
  ],
  rubygems: [
    "rails",
    "rake",
    "bundler",
    "rspec",
    "sinatra",
    "puma",
    "devise",
    "sidekiq",
    "redis",
    "nokogiri",
    "rubocop",
    "stripe"
  ],
  crates: [
    "serde",
    "tokio",
    "clap",
    "rand",
    "log",
    "reqwest",
    "regex",
    "chrono",
    "uuid",
    "anyhow",
    "serde_json",
    "actix-web",
    "axum"
  ]
};
function levenshteinDistance(a, b) {
  if (a.length > b.length) {
    [a, b] = [b, a];
  }
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      if (a[i - 1] === b[j - 1]) {
        curr[i] = prev[i - 1];
      } else {
        curr[i] = 1 + Math.min(prev[i], curr[i - 1], prev[i - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m] ?? 0;
}
function findSimilarPackages(packageName, ecosystem, maxDistance = 2, limit = 5) {
  const knownPackages = TOP_PACKAGES[ecosystem];
  if (!knownPackages) return [];
  const normalizedInput = packageName.toLowerCase().replace(/^@/, "");
  const unscopedInput = normalizedInput.includes("/") ? normalizedInput.split("/").pop() ?? normalizedInput : normalizedInput;
  const matches = [];
  for (const known of knownPackages) {
    const normalizedKnown = known.toLowerCase();
    if (unscopedInput === normalizedKnown) continue;
    if (Math.abs(unscopedInput.length - normalizedKnown.length) > maxDistance) continue;
    const distance = levenshteinDistance(unscopedInput, normalizedKnown);
    if (distance >= 1 && distance <= maxDistance) {
      matches.push({ name: known, distance });
    }
  }
  return matches.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name)).slice(0, limit);
}

// features/security-analysis/package-security/dependency-confusion.ts
var INTERNAL_PREFIXES = [
  "internal-",
  "private-",
  "priv-",
  "corp-",
  "company-",
  "org-",
  "dev-",
  "local-"
];
var SCOPED_PACKAGE_RE = /^@([a-z0-9-]+)\//;
var INTERNAL_SCOPE_WORDS = INTERNAL_PREFIXES.map((prefix) => prefix.replace(/-$/, ""));
function looksLikeInternalScope(scope) {
  return INTERNAL_SCOPE_WORDS.some((word) => scope === word || scope.startsWith(`${word}-`));
}
function checkDependencyConfusion(packageName, ecosystem) {
  const scopedMatch = packageName.match(SCOPED_PACKAGE_RE);
  if (scopedMatch) {
    const scope = scopedMatch[1];
    const unscopedName = packageName.replace(SCOPED_PACKAGE_RE, "");
    const similar = findSimilarPackages(unscopedName, ecosystem, 1, 1);
    if (similar.length > 0) {
      return {
        risk: true,
        rule: "package.dependency-confusion.scoped-public-collision",
        message: `Scoped package '${packageName}' contains unscoped name '${unscopedName}' similar to known public package '${similar[0]?.name}'. Verify scope authenticity to avoid dependency confusion.`,
        confidence: "HIGH"
      };
    }
    if (looksLikeInternalScope(scope)) {
      return {
        risk: true,
        rule: "package.dependency-confusion.scoped-internal",
        message: `Scoped package '${packageName}' follows an internal naming pattern (@${scope}/...). Ensure the scope is authentic and not a dependency confusion target.`,
        confidence: "MEDIUM"
      };
    }
    return null;
  }
  const lowerName = packageName.toLowerCase();
  for (const prefix of INTERNAL_PREFIXES) {
    if (lowerName.startsWith(prefix)) {
      const baseName = lowerName.slice(prefix.length);
      if (baseName.length > 0) {
        return {
          risk: true,
          rule: "package.dependency-confusion.internal-prefix",
          message: `Package '${packageName}' uses the '${prefix}' prefix which suggests an internal/private package. Confirm it resolves to the intended private source.`,
          confidence: "MEDIUM"
        };
      }
    }
  }
  return null;
}

// features/security-analysis/package-security/extract-dependencies.ts
function basename3(path) {
  return path.split("/").pop() ?? path;
}
function lineAt(content, needle) {
  return findLineNumber(content, needle);
}
function classifyNpmVersion(versionRange) {
  const value = versionRange.trim();
  if (/^workspace:/.test(value)) return "workspace";
  if (/^(file:|link:)/.test(value)) return value.startsWith("link:") ? "link" : "file";
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(value)) return "git";
  if (/^https?:\/\//.test(value)) return "git";
  return "registry";
}
function parseScopedName(name) {
  const match = name.match(/^(@[^/]+\/)(.+)$/);
  if (!match) return { name };
  return { name, scope: match[1]?.slice(0, -1) };
}
function pushDependency(deps, input) {
  const parsed = parseScopedName(input.name);
  deps.push({ ...input, scope: parsed.scope ?? input.scope });
}
function parseRequirementsTxt(path, content) {
  const deps = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]?.trim() ?? "";
    if (!raw || raw.startsWith("#") || raw.startsWith("-r ") || raw.startsWith("-c ")) continue;
    const match = raw.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[.*\])?(?:[=<>!~]=|[<>=~!]|$)/);
    if (!match?.[1]) continue;
    const name = match[1].replace(/_/g, "-").toLowerCase();
    const versionMatch = raw.match(/[=<>!~]=\s*([^\s;#]+)/);
    pushDependency(deps, {
      name,
      version: versionMatch?.[1] ?? "unknown",
      ecosystem: "pypi",
      file: path,
      line: index + 1,
      source: "requirements",
      kind: /^(\.\/|\.\.\/|file:|git\+)/.test(raw) ? "local-path" : "registry"
    });
  }
  return deps;
}
function parsePyprojectToml(path, content) {
  const deps = [];
  const depBlock = content.match(/\[project\.dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  if (!depBlock) return deps;
  for (const match of depBlock.matchAll(/^\s*"?([A-Za-z0-9][A-Za-z0-9._-]*)"?\s*=\s*"([^"]+)"/gm)) {
    const name = match[1]?.replace(/_/g, "-").toLowerCase();
    if (!name || name === "python") continue;
    pushDependency(deps, {
      name,
      version: match[2] ?? "unknown",
      ecosystem: "pypi",
      file: path,
      line: lineAt(content, match[0]),
      source: "pyproject",
      kind: "registry"
    });
  }
  return deps;
}
function parseCargoToml(path, content) {
  const deps = [];
  const depBlock = content.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  if (!depBlock) return deps;
  for (const match of depBlock.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/gm)) {
    pushDependency(deps, {
      name: match[1],
      version: match[2] ?? "unknown",
      ecosystem: "crates",
      file: path,
      line: lineAt(content, match[0]),
      source: "cargo",
      kind: "registry"
    });
  }
  return deps;
}
function parseGoMod(path, content) {
  const deps = [];
  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/)?.[1];
  const lines = requireBlock ? requireBlock.split("\n") : content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const match = trimmed.match(/^([^\s]+)\s+([^\s]+)/);
    if (!match) continue;
    const modPath = match[1];
    if (modPath === "require" || modPath.startsWith("replace")) continue;
    pushDependency(deps, {
      name: modPath,
      version: match[2] ?? "unknown",
      ecosystem: "go",
      file: path,
      line: lineAt(content, modPath),
      source: "go-mod",
      kind: modPath.includes("/./") || modPath.startsWith("./") ? "local-path" : "registry"
    });
  }
  return deps;
}
function parseGemfile(path, content) {
  const deps = [];
  for (const match of content.matchAll(/^\s*gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/gm)) {
    pushDependency(deps, {
      name: match[1],
      version: match[2] ?? "unknown",
      ecosystem: "rubygems",
      file: path,
      line: lineAt(content, match[0]),
      source: "gemfile",
      kind: "registry"
    });
  }
  return deps;
}
function parsePackageJsonManifest(path, content) {
  const manifest = JSON.parse(content);
  const deps = [];
  const sections = [
    [manifest.dependencies, false],
    [manifest.devDependencies, true],
    [manifest.optionalDependencies, false]
  ];
  for (const [section, isDev] of sections) {
    for (const [name, versionRange] of Object.entries(section ?? {})) {
      pushDependency(deps, {
        name,
        version: versionRange.replace(/^[\^~>=<\s]+/, "").split(",")[0]?.trim() || "unknown",
        ecosystem: "npm",
        file: path,
        line: lineAt(content, `"${name}"`),
        source: "manifest",
        kind: classifyNpmVersion(versionRange),
        isDev
      });
    }
  }
  return deps;
}
function fromSbomComponents(components) {
  return components.map((component) => ({
    name: component.name,
    version: component.version,
    ecosystem: component.ecosystem,
    file: component.lockfilePath ?? "unknown",
    line: 1,
    source: component.lockfilePath?.endsWith("package.json") ? "manifest" : "lockfile",
    kind: "registry",
    isDev: component.isDev,
    scope: component.namespace
  }));
}
function extractDeclaredDependencies(files, options) {
  const deps = [];
  const workspaceNames = /* @__PURE__ */ new Set();
  for (const file2 of files) {
    const name = basename3(file2.path);
    if (name !== "package.json") continue;
    try {
      const manifest = JSON.parse(file2.content);
      if (manifest.name) workspaceNames.add(manifest.name);
      const workspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages ?? [];
      for (const pattern of workspaces) {
        workspaceNames.add(pattern.replace(/\*$/, "").replace(/\/$/, ""));
      }
    } catch {
    }
  }
  for (const file2 of files) {
    const name = basename3(file2.path);
    try {
      switch (name) {
        case "package.json":
          deps.push(...parsePackageJsonManifest(file2.path, file2.content));
          break;
        case "requirements.txt":
          deps.push(...parseRequirementsTxt(file2.path, file2.content));
          break;
        case "pyproject.toml":
          deps.push(...parsePyprojectToml(file2.path, file2.content));
          break;
        case "Cargo.toml":
          deps.push(...parseCargoToml(file2.path, file2.content));
          break;
        case "go.mod":
          deps.push(...parseGoMod(file2.path, file2.content));
          break;
        case "Gemfile":
          deps.push(...parseGemfile(file2.path, file2.content));
          break;
        default:
          break;
      }
    } catch {
    }
  }
  deps.push(
    ...options?.sbomComponents ? fromSbomComponents(options.sbomComponents) : fromSbomComponents(discoverComponentsFromFiles(files, { includeDev: true }))
  );
  return dedupeDeclaredDependencies(deps, workspaceNames);
}
function dedupeDeclaredDependencies(deps, workspaceNames = /* @__PURE__ */ new Set()) {
  const seen = /* @__PURE__ */ new Map();
  for (const dep of deps) {
    if (NPM_BUILTIN_PACKAGES.has(dep.name)) continue;
    if (workspaceNames.has(dep.name)) {
      dep.kind = "workspace";
    }
    const key = `${dep.ecosystem}:${dep.name.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || sourcePriority(dep.source) > sourcePriority(existing.source)) {
      seen.set(key, dep);
    }
  }
  return [...seen.values()];
}
function sourcePriority(source) {
  switch (source) {
    case "lockfile":
      return 4;
    case "manifest":
      return 3;
    case "pyproject":
    case "cargo":
    case "go-mod":
    case "gemfile":
      return 3;
    case "requirements":
      return 2;
    default:
      return 1;
  }
}
function detectPrimaryEcosystems(files) {
  const ecosystems = /* @__PURE__ */ new Set();
  for (const file2 of files) {
    const name = basename3(file2.path);
    if (name === "package.json" || name.endsWith("package-lock.json") || name === "yarn.lock") {
      ecosystems.add("npm");
    }
    if (name === "requirements.txt" || name === "pyproject.toml" || name === "poetry.lock") {
      ecosystems.add("pypi");
    }
    if (name === "Cargo.toml" || name === "Cargo.lock") ecosystems.add("crates");
    if (name === "go.mod" || name === "go.sum") ecosystems.add("go");
    if (name === "Gemfile" || name === "Gemfile.lock") ecosystems.add("rubygems");
  }
  return ecosystems;
}
function isInternalDependency(dep) {
  return dep.kind === "workspace" || dep.kind === "local-path" || dep.kind === "git" || dep.kind === "file" || dep.kind === "link";
}
function isLikelyPrivatePackage(dep) {
  if (isInternalDependency(dep)) return true;
  if (dep.name.startsWith("internal-") || dep.name.startsWith("private-")) return true;
  if (dep.ecosystem === "npm" && dep.name.startsWith("@") && dep.scope && !isLikelyPublicScope(dep.scope)) {
    return true;
  }
  return false;
}
function isLikelyPublicScope(scope) {
  const normalized = scope.replace(/^@/, "").toLowerCase();
  return ["types", "babel", "typescript-eslint", "eslint", "vue", "angular", "nestjs", "radix-ui"].some(
    (prefix) => normalized.startsWith(prefix)
  );
}
function detectEcosystemMismatch(dep, primaryEcosystems) {
  if (primaryEcosystems.size <= 1) return false;
  if (dep.ecosystem === "npm" && primaryEcosystems.has("pypi") && !primaryEcosystems.has("npm")) {
    return true;
  }
  if (dep.ecosystem === "pypi" && primaryEcosystems.has("npm") && !primaryEcosystems.has("pypi")) {
    return true;
  }
  return false;
}

// features/security-analysis/package-security/analyze.ts
function pushFinding(findings, finding) {
  findings.push(finding);
}
function buildNotFoundFinding(dep, lookup) {
  const similar = findSimilarPackages(dep.name, dep.ecosystem);
  const hasStrongTyposquat = similar.some((entry) => entry.distance === 1);
  return {
    rule: hasStrongTyposquat ? "package.typosquat.not-found" : "package.hallucination.not-found",
    severity: hasStrongTyposquat ? "HIGH" : "HIGH",
    action: hasStrongTyposquat ? "BLOCK" : "WARN",
    message: hasStrongTyposquat ? `Dependency '${dep.name}' was not found in the ${dep.ecosystem} registry and closely resembles '${similar[0]?.name}'. This may be a hallucinated or typosquatted package name.` : `Dependency '${dep.name}' was not found in the ${dep.ecosystem} registry. Verify this package exists before installing it.`,
    category: hasStrongTyposquat ? "package-typosquat" : "package-hallucination",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: "HIGH",
    tier: hasStrongTyposquat ? "typosquat-candidate" : "potential-hallucination",
    similarPackages: similar,
    registryEvidence: lookup.registryUrl,
    match: dep.name
  };
}
function buildTyposquatFinding(dep, similar) {
  if (similar.length === 0) return null;
  const closest = similar[0];
  return {
    rule: "package.typosquat.similar-name",
    severity: closest.distance === 1 ? "HIGH" : "MEDIUM",
    action: closest.distance === 1 ? "BLOCK" : "WARN",
    message: `Dependency '${dep.name}' closely resembles known package '${closest.name}' (edit distance ${closest.distance}). Confirm the intended package to avoid typosquatting.`,
    category: "package-typosquat",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: closest.distance === 1 ? "HIGH" : "MEDIUM",
    tier: "typosquat-candidate",
    similarPackages: similar,
    match: dep.name
  };
}
function buildConfusionFinding(dep, signal) {
  return {
    rule: signal.rule,
    severity: signal.confidence === "HIGH" ? "HIGH" : "MEDIUM",
    action: "WARN",
    message: signal.message,
    category: "dependency-confusion",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: signal.confidence,
    tier: "dependency-confusion",
    match: dep.name
  };
}
function buildMismatchFinding(dep) {
  return {
    rule: "package.ecosystem.mismatch",
    severity: "MEDIUM",
    action: "WARN",
    message: `Dependency '${dep.name}' is declared for ${dep.ecosystem} but the repository appears to primarily use a different ecosystem. This may be an AI-generated dependency mismatch.`,
    category: "ecosystem-mismatch",
    file: dep.file,
    line: dep.line,
    packageName: dep.name,
    ecosystem: dep.ecosystem,
    requestedVersion: dep.version,
    confidence: "MEDIUM",
    tier: "ecosystem-mismatch",
    match: dep.name
  };
}
function dedupePackageSecurityFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.rule}|${finding.ecosystem}|${finding.packageName.toLowerCase()}|${finding.file}|${finding.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
async function analyzePackageSecurity(files, options = {}) {
  const findings = [];
  const dependencies = dedupeDeclaredDependencies(
    extractDeclaredDependencies(files, { sbomComponents: options.sbomComponents })
  );
  const primaryEcosystems = detectPrimaryEcosystems(files);
  const registryTargets = dependencies.filter(
    (dep) => REGISTRY_SUPPORTED_ECOSYSTEMS.has(dep.ecosystem) && !isInternalDependency(dep)
  );
  let registryLookups = 0;
  let skippedInternal = dependencies.length - registryTargets.length;
  let registryUnavailable = false;
  const lookupResults = options.skipRegistry || registryTargets.length === 0 ? /* @__PURE__ */ new Map() : await lookupPackages(
    registryTargets.map((dep) => ({ ecosystem: dep.ecosystem, name: dep.name })),
    {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      cache: options.cache ?? createRegistryCache()
    }
  );
  registryLookups = lookupResults.size;
  for (const dep of dependencies) {
    const confusion = checkDependencyConfusion(dep.name, dep.ecosystem);
    if (confusion) {
      pushFinding(findings, buildConfusionFinding(dep, confusion));
    }
    if (detectEcosystemMismatch(dep, primaryEcosystems)) {
      pushFinding(findings, buildMismatchFinding(dep));
    }
    if (isInternalDependency(dep) || !REGISTRY_SUPPORTED_ECOSYSTEMS.has(dep.ecosystem)) {
      continue;
    }
    const lookup = lookupResults.get(cacheKey(dep.ecosystem, dep.name));
    if (!lookup) continue;
    if (lookup.status === "unavailable") {
      registryUnavailable = true;
      continue;
    }
    if (lookup.status === "skipped") continue;
    if (lookup.status === "not_found") {
      if (isLikelyPrivatePackage(dep)) {
        continue;
      }
      pushFinding(findings, buildNotFoundFinding(dep, lookup));
      continue;
    }
    const similar = findSimilarPackages(dep.name, dep.ecosystem, 1, 3);
    const safeSimilar = similar.filter((entry) => entry.distance === 1);
    const typosquatFinding = buildTyposquatFinding(dep, safeSimilar);
    if (typosquatFinding && dep.name !== safeSimilar[0]?.name) {
      pushFinding(findings, typosquatFinding);
    }
  }
  return {
    findings: dedupePackageSecurityFindings(findings),
    dependenciesChecked: dependencies.length,
    registryLookups,
    skippedInternal,
    registryUnavailable
  };
}

// features/security-analysis/package-security/to-findings.ts
function remediationFor2(finding) {
  return PACKAGE_SECURITY_CATEGORY_REMEDIATION[finding.category] ?? "Review this dependency declaration and confirm the package identity before production use.";
}
function mapSeverity(severity) {
  switch (severity) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
function mapCategory2(category) {
  switch (category) {
    case "package-hallucination":
    case "package-typosquat":
    case "dependency-confusion":
      return "supply-chain";
    case "ecosystem-mismatch":
      return "supply-chain";
    default:
      return "supply-chain";
  }
}
function packageSecurityRawFindingToSecurityAnalysis(finding) {
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: mapSeverity(finding.severity),
      category: mapCategory2(finding.category),
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence: finding.confidence,
      action: finding.action,
      matched_text: finding.match,
      metadata: {
        fix: remediationFor2(finding),
        packageName: finding.packageName,
        ecosystem: finding.ecosystem,
        requestedVersion: finding.requestedVersion,
        packageSecurityTier: finding.tier,
        similarPackages: finding.similarPackages,
        registryEvidence: finding.registryEvidence
      }
    },
    PACKAGE_SECURITY_SOURCE_TOOL
  );
  if (!normalized) return null;
  return {
    ...normalized,
    remediation: remediationFor2(finding),
    metadata: {
      ...normalized.metadata ?? {},
      packageSecurity: {
        rule: finding.rule,
        category: finding.category,
        tier: finding.tier,
        packageName: finding.packageName,
        ecosystem: finding.ecosystem,
        requestedVersion: finding.requestedVersion,
        similarPackages: finding.similarPackages ?? [],
        registryEvidence: finding.registryEvidence ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: PACKAGE_SECURITY_SOURCE_TOOL,
        confidence: finding.confidence,
        verificationStatus: normalized.verificationStatus,
        action: finding.action
      }
    }
  };
}
function packageSecurityRawFindingsToSecurityAnalysis(findings) {
  return findings.map(packageSecurityRawFindingToSecurityAnalysis).filter((finding) => finding != null);
}
function dedupePackageSecurityAnalysisFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const packageName = typeof finding.metadata?.packageSecurity === "object" && finding.metadata.packageSecurity && "packageName" in finding.metadata.packageSecurity ? String(finding.metadata.packageSecurity.packageName ?? "") : "";
    const key = `${finding.externalRuleId}|${packageName}|${finding.file ?? ""}|${finding.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/rules/package-security-rule.ts
async function analyzePackageSecurityEvidence(files, options) {
  const scan = await analyzePackageSecurity(files, options);
  const findings = dedupePackageSecurityAnalysisFindings(
    packageSecurityRawFindingsToSecurityAnalysis(scan.findings)
  );
  return { scan, findings };
}
var packageSecurityRule = {
  id: PACKAGE_SECURITY_RULE_ID,
  title: "Package hallucination and dependency confusion analysis",
  run: async ({ files, shared }) => {
    const repositoryFiles = shared?.repositoryFiles ?? toRepositoryFiles(files);
    const { findings } = await analyzePackageSecurityEvidence(repositoryFiles, {
      sbomComponents: shared?.sbomSnapshot.components,
      cache: shared?.registryCache
    });
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  }
};

// features/security-analysis/prompt-injection/constants.ts
var PROMPT_INJECTION_RULE_ID = "prompt-injection.security";
var PROMPT_INJECTION_SOURCE_TOOL = "scan_agent_prompt";
var LLM_INTEGRATION_INDICATORS = [
  /generateText\s*\(/,
  /streamText\s*\(/,
  /embed(?:Many)?\s*\(/,
  /openai\.chat\.completions\.create/,
  /client\.chat\.completions\.create/,
  /anthropic\.messages\.create/,
  /client\.messages\.create/,
  /new\s+Anthropic\s*\(/,
  /PromptTemplate/,
  /ChatPromptTemplate/,
  /from\s+['"]ai['"]/,
  /from\s+['"]@ai-sdk/,
  /from\s+['"]openai['"]/,
  /from\s+['"]@anthropic-ai\/sdk['"]/,
  /systemPrompt|system_prompt|userPrompt|userMessage/,
  /messages\s*:\s*\[/,
  /role\s*:\s*['"](?:system|user|assistant)['"]/
];
var UNTRUSTED_INPUT_INDICATORS = /\$\{(?:request|req|body|input|user|message|prompt|query|params|data)|\b(?:req|request)\.(?:body|query|params)|\buser(?:Input|Message|Prompt|Text)\b|\bbody\.|\binput\b|\bmessage\b|\bprompt\b/i;
var REGEX_SCAN_WINDOW = 2048;
var REGEX_SCAN_OVERLAP = 256;
var PROMPT_CATEGORY_REMEDIATION = {
  "prompt-injection": "Validate and sanitize all user-controlled content before inserting it into LLM prompts. Prefer structured message arrays with fixed system instructions.",
  "prompt-injection-output": "Never execute or deserialize raw LLM output. Parse structured data safely and treat model output as untrusted.",
  exfiltration: "Block instructions that request secrets or code be sent externally. Keep sensitive data out of prompt construction paths.",
  "prompt-injection-jailbreak": "Review prompt templates for override language and keep system instructions immutable.",
  "prompt-injection-content": "Treat matched text as suspicious until verified in runtime context. Do not assume a string match is exploitable without data-flow verification.",
  "malicious-injection": "Remove override or bypass language from prompts exposed to untrusted input.",
  "system-manipulation": "Keep system instructions separate from user-controlled content and validate all dynamic prompt segments.",
  obfuscation: "Inspect encoded or obfuscated prompt segments before passing them to an LLM."
};

// features/security-analysis/prompt-injection/context.ts
function basename4(path) {
  return path.split("/").pop() ?? path;
}
function hasLlmIntegration(content) {
  return LLM_INTEGRATION_INDICATORS.some((pattern) => pattern.test(content));
}
function classifyFileContext(path, content) {
  const lowerPath = path.toLowerCase();
  const name = basename4(lowerPath);
  if (/\.(md|mdx|rst|txt)$/i.test(path) || /(^|\/)docs?\//.test(lowerPath) || /^readme/i.test(name)) {
    return {
      kind: "documentation",
      isLlmRelated: hasLlmIntegration(content),
      suppressContentRules: true,
      confidenceMultiplier: 0.2
    };
  }
  if (/__tests__|(^|\/)tests?\/|\.test\.|\.spec\.|\.stories\.|(^|\/)e2e\//i.test(lowerPath)) {
    return {
      kind: "test",
      isLlmRelated: hasLlmIntegration(content),
      suppressContentRules: false,
      confidenceMultiplier: 0.35
    };
  }
  if (/(^|\/)fixtures?\/|(^|\/)examples?\//i.test(lowerPath) || /fixture|example|sample|mock/i.test(name)) {
    return {
      kind: "fixture",
      isLlmRelated: hasLlmIntegration(content),
      suppressContentRules: false,
      confidenceMultiplier: 0.35
    };
  }
  if (/(^|\/)server\/ai-red-team\/llm-team\/runtime\//i.test(lowerPath)) {
    return {
      kind: "fixture",
      isLlmRelated: hasLlmIntegration(content),
      suppressContentRules: true,
      confidenceMultiplier: 0.1
    };
  }
  const llmRelated = hasLlmIntegration(content);
  return {
    kind: llmRelated ? "llm-construction" : "source",
    isLlmRelated: llmRelated,
    suppressContentRules: !llmRelated,
    confidenceMultiplier: llmRelated ? 1 : 0.5
  };
}
function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("--");
}
function lineContextKind(line, fileKind) {
  if (isCommentLine(line)) return "comment";
  if (/['"`][^'"`]*(ignore previous|system prompt|you are now)/i.test(line)) {
    return "prompt-literal";
  }
  return fileKind;
}
function adjustConfidence(base, multiplier) {
  if (multiplier >= 0.9) return base;
  if (multiplier <= 0.4) return "LOW";
  if (base === "HIGH" && multiplier < 0.75) return "MEDIUM";
  if (base === "MEDIUM" && multiplier < 0.5) return "LOW";
  return base;
}
function tierFromContext(baseTier, context, lineKind) {
  if (context.kind === "documentation" || lineKind === "comment") {
    return "potential-pattern";
  }
  if (context.kind === "test" || context.kind === "fixture") {
    return baseTier === "likely-exploitable" ? "suspicious-construction" : "potential-pattern";
  }
  return baseTier;
}
function shouldSkipPath2(path) {
  return path.split("/").some(
    (segment) => ["node_modules", ".git", "dist", "build", "__pycache__", "venv", ".venv", "coverage", ".next", ".nuxt"].includes(
      segment
    )
  );
}
function isScannablePromptFile(path) {
  return /\.(js|jsx|ts|tsx|py|md|mdx)$/i.test(path);
}

// features/security-analysis/prompt-injection/rules-code.ts
var PROMPT_CODE_RULES = [
  {
    id: "javascript.llm.security.prompt-injection.openai-unsafe-template",
    severity: "ERROR",
    category: "prompt-injection",
    message: "User input in OpenAI prompt via template literal. Sanitize user input before including in prompts.",
    pattern: /(?:openai\.chat\.completions\.create|client\.chat\.completions\.create)\s*\([^)]*`[^`]*\$\{/g,
    fileTypes: [".js", ".jsx", ".ts", ".tsx"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "javascript.llm.security.prompt-injection.openai-unsafe-concat",
    severity: "ERROR",
    category: "prompt-injection",
    message: "User input concatenated into OpenAI prompt. Use input sanitization.",
    pattern: /(?:openai\.|client\.chat\.completions\.create)[\s\S]{0,200}?content\s*:\s*[^,}\n]+\+/g,
    fileTypes: [".js", ".jsx", ".ts", ".tsx"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "javascript.llm.security.prompt-injection.anthropic-unsafe",
    severity: "ERROR",
    category: "prompt-injection",
    message: "User input in Anthropic prompt without sanitization. Validate and sanitize before API call.",
    pattern: /(?:anthropic\.messages\.create|client\.messages\.create|new\s+Anthropic)[\s\S]{0,200}?`[^`]*\$\{/g,
    fileTypes: [".js", ".jsx", ".ts", ".tsx"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "typescript.llm.security.prompt-injection.ai-sdk-unsafe-template",
    severity: "ERROR",
    category: "prompt-injection",
    message: "Untrusted data interpolated into Vercel AI SDK prompt. Keep system instructions fixed and validate user content.",
    pattern: /(?:generateText|streamText)\s*\(\s*\{[\s\S]{0,300}?(?:prompt|messages)[\s\S]{0,120}?`[^`]*\$\{/g,
    fileTypes: [".js", ".jsx", ".ts", ".tsx"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "javascript.llm.security.prompt-injection.langchain-unsafe",
    severity: "ERROR",
    category: "prompt-injection",
    message: "LangChain prompt template includes unsanitized interpolation. Validate template variables.",
    pattern: /(?:PromptTemplate\.fromTemplate|ChatPromptTemplate\.fromMessages)\s*\([\s\S]{0,200}?`[^`]*\$\{/g,
    fileTypes: [".js", ".jsx", ".ts", ".tsx"],
    confidence: "HIGH",
    tier: "suspicious-construction",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "javascript.llm.security.output-injection.eval-llm-response",
    severity: "ERROR",
    category: "prompt-injection-output",
    message: "eval() on LLM response. Never execute LLM outputs directly.",
    pattern: /eval\s*\(\s*(?:response|completion|output|result|text|message)/g,
    fileTypes: [".js", ".jsx", ".ts", ".tsx"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    action: "BLOCK"
  },
  {
    id: "javascript.llm.security.output-injection.function-constructor",
    severity: "ERROR",
    category: "prompt-injection-output",
    message: "new Function() with LLM response. This is equivalent to eval().",
    pattern: /new\s+Function\s*\(\s*(?:response|completion|output|result|text|message)/g,
    fileTypes: [".js", ".jsx", ".ts", ".tsx"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    action: "BLOCK"
  },
  {
    id: "python.llm.security.prompt-injection.openai-unsafe-fstring",
    severity: "ERROR",
    category: "prompt-injection",
    message: "User input directly interpolated into OpenAI prompt via f-string.",
    pattern: /(?:client\.chat\.completions\.create|openai\.ChatCompletion\.create)[\s\S]{0,200}?f["']/g,
    fileTypes: [".py"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "python.llm.security.prompt-injection.openai-unsafe-concat",
    severity: "ERROR",
    category: "prompt-injection",
    message: "User input concatenated into OpenAI prompt.",
    pattern: /(?:client\.chat\.completions\.create|openai\.ChatCompletion\.create)[\s\S]{0,200}?\+/g,
    fileTypes: [".py"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "python.llm.security.prompt-injection.anthropic-unsafe-fstring",
    severity: "ERROR",
    category: "prompt-injection",
    message: "User input directly interpolated into Anthropic prompt via f-string.",
    pattern: /(?:anthropic\.messages\.create|client\.messages\.create)[\s\S]{0,200}?f["']/g,
    fileTypes: [".py"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    requiresUntrustedInput: true,
    action: "WARN"
  },
  {
    id: "python.llm.security.output-injection.eval-llm-response",
    severity: "ERROR",
    category: "prompt-injection-output",
    message: "eval() on LLM response. Never execute LLM-generated code directly.",
    pattern: /eval\s*\(\s*(?:response|completion|output|message|text)/g,
    fileTypes: [".py"],
    confidence: "HIGH",
    tier: "likely-exploitable",
    action: "BLOCK"
  }
];

// features/security-analysis/prompt-injection/rules-content.ts
function p(source, flags = "i") {
  return new RegExp(source, flags);
}
var PROMPT_CONTENT_RULES = [
  {
    id: "generic.prompt.security.ignore-previous-instructions",
    severity: "ERROR",
    category: "prompt-injection-jailbreak",
    message: "Prompt injection detected: instruction override attempt trying to bypass system instructions.",
    patterns: [
      p("ignore\\s+(all\\s+)?(previous|prior|above|earlier)\\s+(instructions?|prompts?|rules?|guidelines?)"),
      p("disregard\\s+(all\\s+)?(previous|prior|above)\\s+(instructions?|prompts?)"),
      p("forget\\s+(all\\s+)?(previous|prior|earlier)\\s+(instructions?|prompts?)")
    ],
    confidence: "HIGH",
    action: "BLOCK"
  },
  {
    id: "generic.prompt.security.new-instructions-injection",
    severity: "ERROR",
    category: "malicious-injection",
    message: "Prompt injection detected: attempt to inject new instructions replacing system behavior.",
    patterns: [
      p("your\\s+new\\s+(instructions?|task|role|purpose)\\s+(is|are)\\s*:"),
      p("from\\s+now\\s+on\\s*,?\\s+(you|your)\\s+(will|must|should|are)"),
      p("new\\s+system\\s+prompt\\s*:")
    ],
    confidence: "HIGH",
    action: "BLOCK"
  },
  {
    id: "generic.prompt.security.jailbreak-dan",
    severity: "ERROR",
    category: "prompt-injection-jailbreak",
    message: "Jailbreak attempt detected: DAN-style attack attempting to bypass safety measures.",
    patterns: [p("you\\s+are\\s+(now\\s+)?DAN"), p("do\\s+anything\\s+now")],
    confidence: "HIGH",
    action: "BLOCK"
  },
  {
    id: "generic.prompt.security.system-prompt-extraction",
    severity: "ERROR",
    category: "prompt-injection-content",
    message: "System prompt extraction attempt detected.",
    patterns: [
      p("(reveal|show|display|print|output|repeat|tell\\s+me)\\s+(your|the)\\s+(system\\s+)?prompt"),
      p("what\\s+(is|are)\\s+your\\s+(system\\s+)?instructions?")
    ],
    confidence: "MEDIUM",
    action: "WARN"
  },
  {
    id: "generic.prompt.security.delimiter-injection",
    severity: "ERROR",
    category: "prompt-injection-delimiter",
    message: "Delimiter injection attack: attempting to escape context boundaries.",
    patterns: [p("---+\\s*(system|assistant|user)\\s*---+"), p("<\\|.*\\|>")],
    confidence: "HIGH",
    action: "BLOCK"
  },
  {
    id: "generic.prompt.security.jailbreak-developer-mode",
    severity: "ERROR",
    category: "prompt-injection-jailbreak",
    message: "Developer/debug mode jailbreak: fake mode activation attempt.",
    patterns: [
      p("(enable|activate|enter|switch\\s+to)\\s+(developer|debug|admin|unrestricted)\\s+mode"),
      p("you\\s+(now\\s+)?have\\s+(no|zero)\\s+(restrictions|limitations|filters|guardrails)")
    ],
    confidence: "HIGH",
    action: "BLOCK"
  },
  {
    id: "generic.prompt.security.natural-language-exfiltration",
    severity: "ERROR",
    category: "exfiltration",
    message: "Data exfiltration attempt in prompt-like text.",
    patterns: [
      p("send\\s+.{0,40}(secret|password|key|token|credential|env).{0,40}to\\s+\\S+"),
      p("(show|print|display|read|cat|output)\\s+(me\\s+)?(the\\s+)?(\\.env|env\\s+file|environment\\s+variable)")
    ],
    confidence: "HIGH",
    action: "BLOCK"
  },
  {
    id: "generic.prompt.security.output-manipulation",
    severity: "ERROR",
    category: "prompt-injection-output",
    message: "Output manipulation attempt in prompt-like text.",
    patterns: [
      p("(start|begin)\\s+(your|every|all)\\s+(response|reply|output|answer)\\s+with"),
      p("(always|must|shall)\\s+(include|prepend|append|add).{0,30}(response|reply|output)")
    ],
    confidence: "MEDIUM",
    action: "WARN"
  },
  {
    id: "agent.exfil.security.env-file-access",
    severity: "ERROR",
    category: "exfiltration",
    message: "Explicit request for .env or environment secrets in prompt-like text.",
    patterns: [
      p("(show|print|display|read|cat|output|echo)\\s+(me\\s+)?(the\\s+)?(\\.env|env\\s+file|environment\\s+variable)"),
      p("what\\s+(are|is)\\s+(in\\s+)?(the|my)\\s+\\.?env\\s+(file)?")
    ],
    confidence: "HIGH",
    action: "BLOCK"
  }
];

// features/security-analysis/prompt-injection/text-utils.ts
function safeRegexMatch(text, regex) {
  if (text.length <= REGEX_SCAN_WINDOW) {
    return text.match(regex);
  }
  for (let offset = 0; offset < text.length; offset += REGEX_SCAN_WINDOW - REGEX_SCAN_OVERLAP) {
    const chunk = text.slice(offset, offset + REGEX_SCAN_WINDOW);
    const match = chunk.match(regex);
    if (match) return match;
  }
  return null;
}
function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}
function extractStringLiterals(content) {
  const literals = [];
  const patterns = [
    /`((?:[^`\\]|\\.)*)`/g,
    /"((?:[^"\\]|\\.)*)"/g,
    /'((?:[^'\\]|\\.)*)'/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[0];
      const unquoted = raw.slice(1, -1);
      if (unquoted.trim().length < 8) continue;
      literals.push({
        text: unquoted,
        line: lineNumberAt(content, match.index)
      });
    }
  }
  return literals;
}
function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").replace(/#.*$/gm, " ");
}

// features/security-analysis/prompt-injection/scan-file.ts
function extensionForPath2(path) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}
function hasUntrustedInputNear(content, index) {
  const window = content.slice(Math.max(0, index - 120), index + 220);
  return UNTRUSTED_INPUT_INDICATORS.test(window);
}
function scanCodeRules(path, content, context) {
  const ext = extensionForPath2(path);
  const findings = [];
  for (const rule of PROMPT_CODE_RULES) {
    if (!rule.fileTypes.includes(ext)) continue;
    if (!context.isLlmRelated && rule.category === "prompt-injection") continue;
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (rule.requiresUntrustedInput && !hasUntrustedInputNear(content, match.index)) {
        continue;
      }
      const line = lineNumberAt(content, match.index);
      const lineText = content.split("\n")[line - 1] ?? "";
      const lineKind = lineContextKind(lineText, context.kind);
      const tier = tierFromContext(rule.tier, context, lineKind);
      const confidence = adjustConfidence(rule.confidence, context.confidenceMultiplier);
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        category: rule.category,
        message: rule.message,
        file: path,
        line,
        match: match[0].slice(0, 100),
        confidence,
        action: rule.action ?? "WARN",
        tier,
        riskScore: tier === "likely-exploitable" ? 85 : tier === "suspicious-construction" ? 65 : 40
      });
    }
  }
  return findings;
}
function scanContentRules(path, content, context) {
  if (context.suppressContentRules) return [];
  const findings = [];
  const candidates = extractStringLiterals(content);
  const executable = stripComments(content);
  for (const candidate of candidates) {
    const candidateLine = content.split("\n")[candidate.line - 1] ?? "";
    if (isCommentLine(candidateLine)) continue;
    const lineKind = lineContextKind(candidateLine, context.kind);
    for (const rule of PROMPT_CONTENT_RULES) {
      for (const pattern of rule.patterns) {
        const match = safeRegexMatch(candidate.text, pattern);
        if (!match) continue;
        const tier = tierFromContext("suspicious-construction", context, lineKind);
        const confidence = adjustConfidence(rule.confidence, context.confidenceMultiplier);
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          file: path,
          line: candidate.line,
          match: match[0].slice(0, 100),
          confidence,
          action: rule.action ?? "WARN",
          tier,
          riskScore: 70
        });
        break;
      }
    }
  }
  if (context.isLlmRelated) {
    for (const rule of PROMPT_CONTENT_RULES) {
      for (const pattern of rule.patterns) {
        const match = safeRegexMatch(executable, pattern);
        if (!match) continue;
        const index = executable.indexOf(match[0]);
        const line = lineNumberAt(content, index);
        const lineText = content.split("\n")[line - 1] ?? "";
        if (isCommentLine(lineText)) continue;
        const tier = tierFromContext("suspicious-construction", context, lineContextKind(lineText, context.kind));
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          file: path,
          line,
          match: match[0].slice(0, 100),
          confidence: adjustConfidence(rule.confidence, context.confidenceMultiplier),
          action: rule.action ?? "WARN",
          tier,
          riskScore: 60
        });
        break;
      }
    }
  }
  return findings;
}
function scanPromptInjectionFile(path, content) {
  const context = classifyFileContext(path, content);
  if (context.kind === "documentation" && !context.isLlmRelated) {
    return [];
  }
  if (!context.isLlmRelated && context.kind !== "test" && context.kind !== "fixture") {
    return [];
  }
  return [...scanCodeRules(path, content, context), ...scanContentRules(path, content, context)];
}
function dedupePromptFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.rule}:${finding.file}:${finding.line}:${finding.match ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/prompt-injection/scan-repository.ts
function scanPromptInjectionRepository(files) {
  const findings = [];
  let filesScanned = 0;
  let filesConsidered = 0;
  for (const file2 of files) {
    if (shouldSkipPath2(file2.path)) continue;
    if (!isScannablePromptFile(file2.path)) continue;
    filesConsidered += 1;
    const fileFindings = scanPromptInjectionFile(file2.path, file2.content);
    if (fileFindings.length > 0) {
      filesScanned += 1;
      findings.push(...fileFindings);
    }
  }
  return {
    findings: dedupePromptFindings(findings),
    filesScanned,
    filesConsidered
  };
}

// features/security-analysis/prompt-injection/to-findings.ts
function mapCategory3(category) {
  if (category.startsWith("prompt-injection")) return "prompt-injection";
  if (category === "exfiltration") return "exfiltration";
  if (category === "malicious-injection" || category === "system-manipulation") {
    return "prompt-injection";
  }
  return category;
}
function remediationFor3(finding) {
  return PROMPT_CATEGORY_REMEDIATION[finding.category] ?? PROMPT_CATEGORY_REMEDIATION["prompt-injection-content"] ?? "Review this prompt construction path and verify untrusted input cannot alter system instructions.";
}
function promptRawFindingToSecurityAnalysis(finding) {
  const normalized = normalizeExternalFinding(
    {
      ruleId: finding.rule,
      severity: finding.severity,
      category: mapCategory3(finding.category),
      message: finding.message,
      file: finding.file,
      line: finding.line,
      confidence: finding.confidence,
      action: finding.action,
      risk_score: finding.riskScore,
      matched_text: finding.match,
      metadata: {
        fix: remediationFor3(finding),
        promptCategory: finding.category,
        promptInjectionTier: finding.tier
      }
    },
    PROMPT_INJECTION_SOURCE_TOOL
  );
  if (!normalized) return null;
  return {
    ...normalized,
    remediation: remediationFor3(finding),
    metadata: {
      ...normalized.metadata ?? {},
      promptInjection: {
        rule: finding.rule,
        category: finding.category,
        tier: finding.tier,
        match: finding.match ?? null,
        evidenceSource: AGENT_SECURITY_SCANNER_ID,
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: PROMPT_INJECTION_SOURCE_TOOL,
        confidence: finding.confidence,
        verificationStatus: normalized.verificationStatus,
        action: finding.action
      }
    }
  };
}
function promptRawFindingsToSecurityAnalysis(findings) {
  return findings.map(promptRawFindingToSecurityAnalysis).filter((finding) => finding != null);
}
function dedupePromptSecurityFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const key = `${finding.externalRuleId}|${finding.file ?? ""}|${finding.line ?? ""}|${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/rules/prompt-injection-rule.ts
function analyzePromptInjectionSecurity(files) {
  const scan = scanPromptInjectionRepository(files);
  const findings = dedupePromptSecurityFindings(
    promptRawFindingsToSecurityAnalysis(scan.findings)
  );
  return { scan, findings };
}
var promptInjectionRule = {
  id: PROMPT_INJECTION_RULE_ID,
  title: "Prompt injection security analysis",
  run: ({ files }) => {
    const repositoryFiles = files.map((file2) => ({
      path: file2.path,
      content: file2.content
    }));
    const { findings } = analyzePromptInjectionSecurity(repositoryFiles);
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  }
};

// server/mcp/security/delimiters.ts
var UNTRUSTED_DATA_START = "<<<SEQURAI_UNTRUSTED_REPOSITORY_DATA";
var UNTRUSTED_DATA_END = "<<<END_SEQURAI_UNTRUSTED_REPOSITORY_DATA>>>";
function wrapUntrustedRepositoryData(content, options) {
  const pathAttr = options.path ? ` path="${options.path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : "";
  return `${UNTRUSTED_DATA_START} source="${options.source}"${pathAttr}>>>
${content}
${UNTRUSTED_DATA_END}`;
}

// server/mcp/security/input-guard.ts
function lineNumberForMatch(content, index) {
  return content.slice(0, Math.max(0, index)).split("\n").length;
}
function excerpt(content, index, length = 120) {
  const start = Math.max(0, index - 20);
  const end = Math.min(content.length, index + length);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}
function scanInjectionPatterns(content, options) {
  if (!content?.trim()) return [];
  const detections = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rule of PROMPT_CONTENT_RULES) {
    for (const pattern of rule.patterns) {
      const match = pattern.exec(content);
      if (!match || match.index == null) continue;
      const key = `${rule.id}:${match.index}:${match[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      detections.push({
        ruleId: rule.id,
        category: rule.category,
        message: rule.message,
        action: rule.action === "BLOCK" ? "BLOCK" : "WARN",
        matchedText: excerpt(content, match.index, match[0].length + 40),
        line: lineNumberForMatch(content, match.index),
        source: options.source,
        path: options.path ?? null
      });
    }
  }
  return detections;
}
function guardUntrustedInput(content, options) {
  const original = content ?? "";
  const detections = scanInjectionPatterns(original, options);
  const hadInjectionPattern = detections.some((d) => d.action === "BLOCK") || detections.length > 0;
  const shouldWrap = options.forceWrap === true || hadInjectionPattern;
  const forPrompt = shouldWrap ? wrapUntrustedRepositoryData(original, { source: options.source, path: options.path ?? null }) : original;
  return {
    original,
    forPrompt,
    detections,
    hadInjectionPattern
  };
}

// server/mcp/security/platform-confidence.ts
function derivePlatformInjectionConfidenceLevel() {
  const level = deriveConfidenceLevel({
    detectionMethod: "STATIC_ANALYSIS",
    verificationStatus: "UNVERIFIED",
    llmOnly: false,
    // Heuristic pattern match only — cap below INFERRED threshold (0.55).
    numericScore: 0.35
  });
  assertConfidenceVerificationInvariant("UNVERIFIED", level);
  if (level === "VERIFIED" || level === "PROBABLE") {
    throw new Error("Platform prompt injection findings must never be VERIFIED or PROBABLE");
  }
  return level;
}
function platformInjectionLegacyConfidenceBand() {
  return legacyBandFromConfidenceLevel(derivePlatformInjectionConfidenceLevel());
}

// server/mcp/security/platform-finding.ts
var PLATFORM_INJECTION_RULE_ID = "platform.prompt_injection_attempt";
var PLATFORM_INJECTION_CATEGORY = "prompt_injection_attempt";
function locationForDetection(detection) {
  const path = detection.path ?? (detection.source === "dependency_metadata" ? "dependency-metadata" : detection.source === "commit_history" ? "commit-history" : "platform-untrusted-input");
  return { path, line: detection.line ?? 1 };
}
function platformInjectionToFindingDraft(detection) {
  const location = locationForDetection(detection);
  return {
    ruleId: `${PLATFORM_INJECTION_RULE_ID}.${detection.ruleId}`,
    title: "Prompt injection attempt detected in repository content",
    description: [
      "SequrAI detected instruction-override patterns in untrusted repository content while preparing analysis.",
      "This content was isolated and treated as data \u2014 it cannot change verdict confidence or Safe Fix instructions.",
      "",
      detection.message
    ].join("\n"),
    severity: detection.action === "BLOCK" ? "high" : "medium",
    confidence: platformInjectionLegacyConfidenceBand(),
    category: PLATFORM_INJECTION_CATEGORY,
    location,
    evidence: detection.matchedText,
    remediation: "Review the flagged file or metadata for hostile instructions embedded in comments, README text, commit messages, or dependency descriptions. Remove or rewrite the content so it cannot influence downstream AI analysis.",
    metadata: {
      platformInjectionGuard: {
        source: detection.source,
        path: detection.path ?? null,
        ruleId: detection.ruleId,
        action: detection.action,
        patternCategory: detection.category
      }
    }
  };
}
function platformInjectionFingerprintMaterial(detection) {
  return [
    PLATFORM_INJECTION_RULE_ID,
    detection.source,
    detection.path ?? "",
    detection.ruleId,
    detection.matchedText.slice(0, 120)
  ].join("|");
}
function isPlatformInjectionFinding(finding) {
  return finding.category === PLATFORM_INJECTION_CATEGORY || finding.ruleId.startsWith(`${PLATFORM_INJECTION_RULE_ID}.`);
}

// server/mcp/security/platform-scan.ts
var README_LIKE = /\.(md|markdown|txt)$/i;
var COMMIT_MESSAGE_LIKE = /(commit|changelog|history)/i;
function draftToFinding(draft, detection) {
  const material = platformInjectionFingerprintMaterial(detection);
  const fingerprint = findingFingerprint(
    draft.ruleId,
    draft.location.path,
    draft.location.line,
    material
  );
  return {
    id: `platform-${fingerprint}`,
    fingerprint,
    correlationKey: buildFindingCorrelationKey({
      ruleId: draft.ruleId,
      filePath: draft.location.path,
      fingerprintMaterial: material
    }),
    ...draft
  };
}
function scanFindingFields(finding) {
  const path = finding.location?.path ?? null;
  if (path && TEST_OR_EXAMPLE_PATH.test(path)) return [];
  const fields = [
    ["title", finding.title],
    ["description", finding.description],
    ["evidence", finding.evidence],
    ["remediation", finding.remediation]
  ];
  return fields.flatMap(([field, value]) => {
    if (!value?.trim()) return [];
    return scanInjectionPatterns(value, {
      source: "finding_field",
      path: path ? `${path}#${field}` : field
    });
  });
}
function scanRepositoryFiles(files) {
  return files.flatMap((file2) => {
    const source = README_LIKE.test(file2.path) ? "repository_file" : COMMIT_MESSAGE_LIKE.test(file2.path) ? "commit_history" : null;
    if (!source) return [];
    return scanInjectionPatterns(file2.content, { source, path: file2.path });
  });
}
function collectPlatformInjectionFindings(findings, normalizedFiles) {
  const detections = [];
  const seen = /* @__PURE__ */ new Set();
  for (const finding of findings) {
    for (const detection of scanFindingFields(finding)) {
      const key = platformInjectionFingerprintMaterial(detection);
      if (seen.has(key)) continue;
      seen.add(key);
      detections.push(detection);
    }
  }
  if (normalizedFiles?.length) {
    for (const detection of scanRepositoryFiles(normalizedFiles)) {
      const key = platformInjectionFingerprintMaterial(detection);
      if (seen.has(key)) continue;
      seen.add(key);
      detections.push(detection);
    }
  }
  return detections.map(
    (detection) => draftToFinding(platformInjectionToFindingDraft(detection), detection)
  );
}

// features/security-analysis/osv/enrich-sbom.ts
var OSV_SBOM_RULE_ID = "dependencies.osv-sbom";
var OSV_SBOM_EXTERNAL_RULE_ID = "dependency-vulnerability";
function buildEvidence2(component, vuln) {
  const parts = [
    `Package: ${component.name}@${component.version}`,
    `Ecosystem: ${component.ecosystem}`,
    `Advisory: ${vuln.advisoryId}`,
    `OSV: ${vuln.osvId}`
  ];
  if (vuln.affectedVersionRange) {
    parts.push(`Affected: ${vuln.affectedVersionRange}`);
  }
  if (vuln.fixedVersion) {
    parts.push(`Fixed in: ${vuln.fixedVersion}`);
  }
  parts.push(`Source: OSV (${vuln.sourceUrl})`);
  return parts.join("\n");
}
function buildRemediation2(component, vuln) {
  if (vuln.fixedVersion) {
    return `Upgrade ${component.name} from ${component.version} to ${vuln.fixedVersion} or later. Review the advisory at ${vuln.sourceUrl} before deploying.`;
  }
  return `Review ${component.name}@${component.version} against advisory ${vuln.advisoryId}. See ${vuln.sourceUrl} for mitigation guidance.`;
}
function buildMessage(component, vuln) {
  const severityLabel = vuln.severity === "unknown" ? "unknown severity" : `${vuln.severity} severity`;
  const description = guardUntrustedInput(vuln.description || "Known vulnerability in installed dependency.", {
    source: "dependency_metadata",
    path: `${component.name}@${component.version}`,
    forceWrap: true
  }).forPrompt;
  return `[${vuln.advisoryId}] ${component.name}@${component.version} \u2014 ${severityLabel}. ${description}`;
}
function resolveLocation(files, component) {
  const lockfilePath = component.lockfilePath ?? null;
  if (!lockfilePath) {
    return { file: null, line: null };
  }
  const content = getFileContent(files, lockfilePath);
  if (!content) {
    return { file: lockfilePath, line: 1 };
  }
  const needle = component.name.includes("@") ? `"${component.name}"` : `"${component.name}"`;
  return {
    file: lockfilePath,
    line: findLineNumber(content, needle)
  };
}
function osvVulnerabilityToFinding(component, vuln, files) {
  const confidence = mapOsvConfidence(vuln);
  const severity = mapOsvExternalSeverity(vuln);
  const verificationStatus = deriveInitialVerificationStatus({
    sourceTool: "osv",
    confidence,
    action: null
  });
  const confidenceLevel = deriveConfidenceLevel({
    legacyExternal: confidence,
    verificationStatus
  });
  const location = resolveLocation(files, component);
  const message = buildMessage(component, vuln);
  return {
    scanner: AGENT_SECURITY_SCANNER_ID,
    sourceTool: "osv",
    ruleId: `agent-scanner.osv.${OSV_SBOM_EXTERNAL_RULE_ID}`,
    externalRuleId: OSV_SBOM_EXTERNAL_RULE_ID,
    title: `Vulnerable dependency: ${component.name} (${vuln.advisoryId})`,
    description: vuln.description || message,
    message,
    category: "supply-chain",
    severity: severity.severity,
    originalSeverity: vuln.severity,
    severityRank: severity.severityRank,
    confidence,
    confidenceLevel,
    file: location.file,
    line: location.line,
    column: null,
    evidence: buildEvidence2(component, vuln),
    remediation: buildRemediation2(component, vuln),
    action: null,
    riskScore: vuln.cvssScore,
    cwe: null,
    owasp: null,
    verificationStatus,
    metadata: {
      securityAnalysis: {
        scanner: AGENT_SECURITY_SCANNER_ID,
        sourceTool: "osv",
        externalRuleId: OSV_SBOM_EXTERNAL_RULE_ID,
        verificationStatus,
        confidenceLevel,
        evidenceSource: "osv.dev"
      },
      osv: {
        package: component.name,
        installedVersion: component.version,
        ecosystem: component.ecosystem,
        purl: component.purl,
        advisoryId: vuln.advisoryId,
        osvId: vuln.osvId,
        aliases: vuln.aliases,
        severity: vuln.severity,
        cvssScore: vuln.cvssScore,
        cvssMethod: vuln.cvssMethod,
        affectedVersionRange: vuln.affectedVersionRange,
        fixedVersion: vuln.fixedVersion,
        sourceUrl: vuln.sourceUrl,
        evidenceSource: "osv.dev",
        confidence,
        confidenceLevel,
        verificationStatus
      },
      sbom: {
        lockfilePath: component.lockfilePath ?? null,
        isDirect: component.isDirect ?? false,
        isDev: component.isDev ?? false
      }
    }
  };
}
function osvBatchToFindings(components, batch, files) {
  const findings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const component of components) {
    const key = packageIdentity(component);
    const vulns = batch.get(key) ?? batch.get(component.purl);
    if (!vulns?.length) continue;
    for (const vuln of vulns) {
      const dedupeKey = `${key}|${vuln.osvId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push(osvVulnerabilityToFinding(component, vuln, files));
    }
  }
  return findings;
}
async function analyzeOsvSbomEvidence(files, options = {}) {
  const snapshot = options.sbomSnapshot ?? buildSbomSnapshot(files, { includeDev: options.includeDev ?? true });
  const packages = componentsToOsvPackages(snapshot.components);
  if (packages.length === 0) {
    return { snapshot, findings: [] };
  }
  try {
    const batch = await queryOsvBatch(packages, options.osv);
    const findings = dedupeOsvFindings(osvBatchToFindings(snapshot.components, batch, files));
    return { snapshot, findings };
  } catch (error51) {
    return {
      snapshot,
      findings: [],
      osvError: error51 instanceof Error ? error51.message : "OSV query failed"
    };
  }
}
function dedupeOsvFindings(findings) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const finding of findings) {
    const osvMeta = finding.metadata?.osv;
    const key = `${osvMeta?.purl ?? finding.file ?? "unknown"}|${osvMeta?.osvId ?? finding.externalRuleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

// features/security-analysis/rules/osv-sbom-rule.ts
var osvSbomRule = {
  id: OSV_SBOM_RULE_ID,
  title: "OSV dependency vulnerability evidence",
  run: async ({ files, shared }) => {
    const repositoryFiles = shared?.repositoryFiles ?? toRepositoryFiles(files);
    const { findings } = await analyzeOsvSbomEvidence(repositoryFiles, {
      includeDev: true,
      sbomSnapshot: shared?.sbomSnapshot,
      osv: shared?.osvCache ? { cache: shared.osvCache } : void 0
    });
    if (findings.length === 0) {
      return [];
    }
    return securityAnalysisFindingsToDrafts(findings);
  }
};

// features/security-scanner/rules/dependencies.ts
var LOCAL_DEPENDENCY_CATALOG = [
  {
    package: "node-serialize",
    risk: "Deserializing untrusted data can invoke executable JavaScript behavior.",
    recommendation: "Use JSON data and explicit schema validation instead of executable serialization."
  },
  {
    package: "vm2",
    risk: "In-process isolation is not a security boundary for untrusted code.",
    recommendation: "Do not execute untrusted code, or isolate it outside the application process."
  },
  {
    package: "shelljs",
    risk: "Shell command helpers require strict separation of commands and untrusted input.",
    recommendation: "Prefer non-shell APIs and allowlisted argument arrays."
  },
  {
    package: "next",
    obsoleteBefore: "14.0.0",
    risk: "This major line is outside the local baseline maintained for the scanner.",
    recommendation: "Plan and test an upgrade to a currently supported Next.js release."
  },
  {
    package: "jsonwebtoken",
    obsoleteBefore: "9.0.0",
    risk: "This major line is outside the local baseline maintained for the scanner.",
    recommendation: "Upgrade to a supported major version after reviewing its migration notes."
  }
];
var dependencyRule = {
  id: "dependencies.local-catalog",
  title: "Dependency risk catalog",
  run: ({ getFile }) => {
    const file2 = getFile("package.json");
    if (!file2) return [];
    let manifest;
    try {
      manifest = JSON.parse(file2.content);
    } catch {
      return [];
    }
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies
    };
    const findings = [];
    for (const entry of LOCAL_DEPENDENCY_CATALOG) {
      const installed = dependencies[entry.package];
      if (!installed) continue;
      if (entry.obsoleteBefore && !isClearlyOlder(installed, entry.obsoleteBefore)) continue;
      findings.push({
        ruleId: "dependencies.local-catalog",
        title: entry.obsoleteBefore ? `Outdated dependency baseline: ${entry.package}` : `Review security-sensitive dependency: ${entry.package}`,
        description: entry.risk,
        severity: entry.obsoleteBefore ? "low" : "info",
        confidence: "high",
        category: "dependencies",
        location: { path: file2.path, line: lineOf(file2.content, `"${entry.package}"`) },
        evidence: `${entry.package}: ${installed}`,
        remediation: entry.recommendation,
        fingerprintMaterial: entry.package,
        metadata: {
          advisorySource: "local-baseline",
          claimsCve: false,
          ...entry.obsoleteBefore ? { minimumBaseline: entry.obsoleteBefore } : {}
        }
      });
    }
    for (const [name, version2] of Object.entries(dependencies)) {
      if (!/^(?:https?:|git\+|git:|github:)/i.test(version2)) continue;
      findings.push({
        ruleId: "dependencies.local-catalog",
        title: `Non-registry dependency: ${name}`,
        description: "A dependency is installed directly from a remote URL or VCS reference, reducing lockfile provenance guarantees.",
        severity: "low",
        confidence: "high",
        category: "supply-chain",
        location: { path: file2.path, line: lineOf(file2.content, `"${name}"`) },
        evidence: `${name}: remote reference`,
        remediation: "Pin an immutable commit and verify provenance, or use a trusted registry release.",
        fingerprintMaterial: name,
        metadata: { claimsCve: false }
      });
    }
    return findings;
  }
};
function lineOf(content, value) {
  const index = content.indexOf(value);
  return index < 0 ? 1 : content.slice(0, index).split("\n").length;
}
function isClearlyOlder(versionRange, baseline) {
  const installed = versionRange.match(/\d+(?:\.\d+){0,2}/)?.[0];
  if (!installed) return false;
  const left = installed.split(".").map(Number);
  const right = baseline.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

// features/security-scanner/rules/readiness-areas.ts
function pushBaseline(findings, area, level, title, description, path) {
  findings.push({
    ruleId: "readiness.area-baseline",
    title,
    description,
    severity: "info",
    confidence: "high",
    category: area,
    location: { path, line: 1 },
    evidence: `area=${area};level=${level}`,
    remediation: "Keep monitoring this area on each production review.",
    fingerprintMaterial: `${area}:${level}`,
    metadata: {
      readinessArea: area,
      readinessLevel: level
    }
  });
}
function countMatches(paths, pattern) {
  return paths.filter((path) => pattern.test(path)).length;
}
var readinessAreasRule = {
  id: "readiness.area-baseline",
  title: "Production readiness area baselines",
  run: ({ files }) => {
    const paths = files.map((file2) => file2.path);
    const findings = [];
    const anchor = paths.find((p2) => p2.endsWith("package.json")) ?? "package.json";
    const hasPkg = paths.some((p2) => p2.endsWith("package.json"));
    const hasLock = paths.some(
      (p2) => /(?:^|\/)package-lock\.json$|(?:^|\/)pnpm-lock\.yaml$|(?:^|\/)yarn\.lock$/.test(p2)
    );
    if (hasPkg) {
      pushBaseline(
        findings,
        "dependencies",
        hasLock ? "evaluated" : "partial",
        hasLock ? "Dependencies lockfile present" : "Dependency manifest scanned",
        hasLock ? "package.json and a lockfile were analyzed for supply-chain hygiene." : "package.json was analyzed; add a lockfile for stronger reproducibility signals.",
        anchor
      );
    }
    const testFiles = countMatches(paths, /\.(?:test|spec)\.[cm]?tsx?$/i);
    const hasTestRunner = paths.some((p2) => /vitest\.config|jest\.config/.test(p2));
    if (testFiles > 0 || hasTestRunner) {
      pushBaseline(
        findings,
        "testing",
        testFiles >= 5 && hasTestRunner ? "evaluated" : "partial",
        "Automated tests detected in repository",
        `Found ${testFiles} test files${hasTestRunner ? " and a test runner config" : ""}.`,
        paths.find((p2) => /\.(?:test|spec)\./.test(p2)) ?? anchor
      );
    }
    const perfSignals = countMatches(
      paths,
      /server\/cache\/|operation-timing|next\.config/
    );
    if (perfSignals > 0) {
      pushBaseline(
        findings,
        "performance",
        perfSignals >= 2 ? "evaluated" : "partial",
        "Performance-oriented patterns detected",
        "Caching, timing instrumentation, or Next.js config were found in the scanned tree.",
        paths.find((p2) => /next\.config/.test(p2)) ?? anchor
      );
    }
    const obsSignals = countMatches(
      paths,
      /server\/observability\/|operational-events|api\/internal\/jobs\/health/
    );
    if (obsSignals > 0) {
      pushBaseline(
        findings,
        "observability",
        obsSignals >= 2 ? "evaluated" : "partial",
        "Observability hooks present",
        "Metrics, operational events, or internal health endpoints were detected.",
        paths.find((p2) => p2.includes("server/observability/")) ?? anchor
      );
    }
    const relSignals = countMatches(
      paths,
      /inngest\/functions\/|scan-job-recovery|server\/observability\/idempotency/
    );
    if (relSignals > 0) {
      pushBaseline(
        findings,
        "reliability",
        relSignals >= 2 ? "evaluated" : "partial",
        "Background job and recovery patterns detected",
        "Inngest workers, recovery flows, or idempotency helpers were found.",
        paths.find((p2) => p2.includes("scan-job-recovery")) ?? anchor
      );
    }
    return findings;
  }
};

// features/security-scanner/rules/security-area-baseline.ts
var AREA_PATTERNS = {
  authentication: /(?:auth|login|signin|signup|session|jwt|oauth|password|magic-link)/i,
  authorization: /(?:authz|rbac|permission|role|admin|ownership|tenant|organization)/i,
  secrets: /(?:secret|credential|api[_-]?key|\.env|token)/i,
  database: /(?:\.sql|supabase|postgres|prisma|drizzle|rls|migration)/i,
  api: /(?:^|\/)(?:api|routes?|handlers?)(?:\/|$)|route\.[jt]s$/i,
  web: /\.(?:jsx|tsx|html)$|(?:^|\/)app\//i,
  cicd: /^\.github\/workflows\/.+\.ya?ml$/i,
  dependencies: /(?:^|\/)package\.json$|(?:^|\/)package-lock\.json$|(?:^|\/)pnpm-lock\.yaml$/i
};
function pushAreaBaseline(findings, area, path, signal) {
  findings.push({
    ruleId: "security.area-baseline",
    title: `${area} coverage evaluated`,
    description: `Static security rules analyzed ${area}-related signals in the repository.`,
    severity: "info",
    confidence: "high",
    category: "architecture",
    location: { path, line: 1 },
    evidence: `area=${area};level=evaluated;signal=${signal}`,
    remediation: "Re-run Production Review after significant changes in this area.",
    fingerprintMaterial: `${area}:evaluated`,
    metadata: { securityArea: area, readinessLevel: "evaluated" }
  });
}
var securityAreaBaselineRule = {
  id: "security.area-baseline",
  title: "Security area coverage baselines",
  run: ({ files }) => {
    if (files.length === 0) return [];
    const paths = files.map((file2) => file2.path);
    const anchor = paths[0] ?? "repository";
    const findings = [];
    const seen = /* @__PURE__ */ new Set();
    for (const file2 of files) {
      for (const [area, pattern] of Object.entries(AREA_PATTERNS)) {
        if (seen.has(area)) continue;
        if (!pattern.test(file2.path) && !pattern.test(file2.content.slice(0, 4e3))) continue;
        seen.add(area);
        pushAreaBaseline(findings, area, file2.path, file2.path);
      }
    }
    if (findings.length === 0) {
      pushAreaBaseline(findings, "api", anchor, "repository-scan");
    }
    return findings;
  }
};

// features/security-scanner/rules/registry.ts
var RuleRegistry = class {
  constructor(rules = []) {
    this.rules = /* @__PURE__ */ new Map();
    for (const rule of rules) this.register(rule);
  }
  register(rule) {
    if (this.rules.has(rule.id)) throw new Error(`Duplicate security rule id: ${rule.id}`);
    this.rules.set(rule.id, rule);
    return this;
  }
  list() {
    return [...this.rules.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
};
function createDefaultRegistry() {
  return new RuleRegistry([
    ...BUILTIN_RULES,
    ...EXTENDED_RULES,
    dependencyRule,
    osvSbomRule,
    mcpSecurityRule,
    promptInjectionRule,
    agentActionRule,
    packageSecurityRule,
    readinessAreasRule,
    securityAreaBaselineRule
  ]);
}

// features/security-scanner/scoring.ts
var SEVERITIES = ["critical", "high", "medium", "low", "info"];
var CONFIDENCE_FACTOR = { high: 1, medium: 0.8, low: 0.5 };
var MAX_OCCURRENCES_PER_RULE = 3;
var SCORE_PENALTY_SCALE = 6;
function scoreFromRawPenalty(totalRawPenalty) {
  if (totalRawPenalty <= 0) return 100;
  return Math.max(
    0,
    Math.min(100, Math.round(100 - SCORE_PENALTY_SCALE * Math.sqrt(totalRawPenalty)))
  );
}
function scoreFindings(findings) {
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const deductions = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const ruleSeverityDeductions = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    counts[finding.severity] += 1;
    const weighted = SEVERITY_WEIGHT[finding.severity] * CONFIDENCE_FACTOR[finding.confidence];
    const bucket = `${finding.ruleId}:${finding.severity}`;
    const current = ruleSeverityDeductions.get(bucket) ?? 0;
    const cap = SEVERITY_WEIGHT[finding.severity] * MAX_OCCURRENCES_PER_RULE;
    const applied = Math.max(0, Math.min(weighted, cap - current));
    ruleSeverityDeductions.set(bucket, current + applied);
    deductions[finding.severity] += applied;
  }
  for (const severity of SEVERITIES) deductions[severity] = Math.round(deductions[severity]);
  const totalRawPenalty = Object.values(deductions).reduce((sum, value) => sum + value, 0);
  const score = scoreFromRawPenalty(totalRawPenalty);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  return { score, grade, counts, deductions };
}

// features/security-scanner/stack.ts
var LANGUAGE_BY_EXTENSION = {
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".sql": "SQL"
};
function detectStack(files) {
  const languages = /* @__PURE__ */ new Set();
  const frameworks = /* @__PURE__ */ new Set();
  const services = /* @__PURE__ */ new Set();
  const packageManagers = /* @__PURE__ */ new Set();
  let dependencies = {};
  const packageFile = files.find((file2) => file2.path === "package.json");
  let packages = /* @__PURE__ */ new Set();
  if (packageFile) {
    try {
      const manifest = JSON.parse(packageFile.content);
      packages = /* @__PURE__ */ new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {})
      ]);
      dependencies = Object.fromEntries(
        Object.entries({
          ...manifest.dependencies ?? {},
          ...manifest.devDependencies ?? {}
        }).map(([name, version2]) => [name, safeDependencyVersion(version2)])
      );
      if (manifest.engines?.node || Object.keys(manifest.scripts ?? {}).length > 0) {
        frameworks.add("Node.js");
      }
    } catch {
    }
  }
  const hasPackage = (name) => packages.has(name);
  if (hasPackage("next")) frameworks.add("Next.js");
  if (hasPackage("react") || hasPackage("react-dom")) frameworks.add("React");
  if (hasPackage("express")) frameworks.add("Express");
  if (hasPackage("vite")) frameworks.add("Vite");
  if (hasPackage("vue")) frameworks.add("Vue");
  if (hasPackage("@angular/core")) frameworks.add("Angular");
  if (hasPackage("@nestjs/core")) frameworks.add("NestJS");
  if (hasPackage("fastify")) frameworks.add("Fastify");
  if (hasPackage("@remix-run/react")) frameworks.add("Remix");
  if ([...packages].some((name) => name.startsWith("@supabase/"))) services.add("Supabase");
  if (hasPackage("firebase") || hasPackage("firebase-admin")) services.add("Firebase");
  if (hasPackage("@prisma/client") || hasPackage("prisma")) services.add("Prisma");
  if (hasPackage("pg") || hasPackage("postgres")) services.add("PostgreSQL");
  if (hasPackage("mongodb") || hasPackage("mongoose")) services.add("MongoDB");
  for (const file2 of files) {
    const language = LANGUAGE_BY_EXTENSION[file2.extension];
    if (language) languages.add(language);
    if (/^next\.config\.[cm]?[jt]s$/.test(file2.path)) frameworks.add("Next.js");
    if (/^vite\.config\.(?:[cm]?[jt]s|mts)$/.test(file2.path)) frameworks.add("Vite");
    if (/^angular\.json$/.test(file2.path)) frameworks.add("Angular");
    if (file2.extension === ".jsx" || file2.extension === ".tsx") frameworks.add("React");
    if (file2.path.endsWith(".prisma")) services.add("Prisma");
    if (/^(?:Dockerfile|docker-compose\.ya?ml)$/.test(file2.path)) services.add("Docker");
    if (file2.path === "vercel.json") services.add("Vercel");
    if (/(?:^|\/)(?:firestore|storage)\.rules$/.test(file2.path)) services.add("Firebase");
    if (/supabase\/migrations\/.+\.sql$/.test(file2.path)) services.add("Supabase");
    if (file2.path === "package-lock.json") packageManagers.add("npm");
    if (file2.path === "pnpm-lock.yaml") packageManagers.add("pnpm");
    if (file2.path === "yarn.lock") packageManagers.add("Yarn");
    if (file2.path === "bun.lockb" || file2.path === "bun.lock") packageManagers.add("Bun");
  }
  const sorted = (values) => [...values].sort();
  return {
    languages: sorted(languages),
    frameworks: sorted(frameworks),
    services: sorted(services),
    packageManagers: sorted(packageManagers),
    dependencies: Object.fromEntries(
      Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right))
    )
  };
}
function safeDependencyVersion(version2) {
  if (/^(?:https?:|git(?:\+|:)|github:)/i.test(version2) || /:\/\/[^/\s]+@/.test(version2)) {
    return "[remote-reference]";
  }
  if (/^(?:workspace:|file:|link:)/i.test(version2)) return "[local-reference]";
  return /^[~^<>=*0-9xXv.\s|/-]{1,80}$/.test(version2) ? version2 : "[non-registry-reference]";
}

// brain/evidence-finding/project-context.ts
var MARKETING_HINTS = [
  /^app\/page\.[jt]sx?$/,
  /^pages\/index\.[jt]sx?$/,
  /^app\/\(marketing\)/,
  /^components\/(hero|landing|marketing)/i
];
var API_HINTS = [/^app\/api\//, /^pages\/api\//, /^server\/.*\/route\.[jt]s$/];
function analyzeProjectContext(filePaths) {
  const paths = [...filePaths];
  const normalized = paths.map((path) => path.replace(/\\/g, "/"));
  const hasMiddleware = normalized.some((path) => /(?:^|\/)middleware\.[jt]s$/.test(path));
  const hasAppRouter = normalized.some((path) => /^app\//.test(path));
  const hasAppApi = normalized.some((path) => /^app\/api\//.test(path));
  const hasPagesApi = normalized.some((path) => /^pages\/api\//.test(path));
  const hasAuthLib = normalized.some(
    (path) => /(?:auth|session|login|sign-in|signin)/i.test(path)
  );
  const hasSupabaseAuth = normalized.some(
    (path) => /(?:supabase|createClient|auth\.ts|auth\.js)/i.test(path)
  );
  const hasNextAuth = normalized.some((path) => /next-auth|NextAuth/i.test(path));
  const apiCount = normalized.filter((path) => API_HINTS.some((re) => re.test(path))).length;
  const marketingCount = normalized.filter(
    (path) => MARKETING_HINTS.some((re) => re.test(path))
  ).length;
  let projectType = "unknown";
  if (apiCount >= 3 && hasAppApi) {
    projectType = "saas_application";
  } else if (apiCount >= 5 && !hasAppRouter) {
    projectType = "api_service";
  } else if (/admin/i.test(normalized.join(" "))) {
    projectType = "admin_panel";
  } else if (marketingCount >= 2 && apiCount === 0) {
    projectType = "marketing_website";
  } else if (/docs|documentation/i.test(normalized.join(" "))) {
    projectType = "documentation";
  } else if (hasAppRouter && apiCount > 0) {
    projectType = "dashboard";
  } else if (marketingCount >= 1 && apiCount <= 1) {
    projectType = "landing_page";
  }
  const recommendedAuthPaths = [];
  if (hasMiddleware) recommendedAuthPaths.push("middleware.ts");
  if (hasAppApi) recommendedAuthPaths.push("app/api/**/route.ts");
  if (hasPagesApi) recommendedAuthPaths.push("pages/api/**/*.ts");
  if (hasSupabaseAuth) recommendedAuthPaths.push("lib/supabase/server.ts", "utils/supabase/server.ts");
  if (hasNextAuth) recommendedAuthPaths.push("app/api/auth/[...nextauth]/route.ts", "pages/api/auth/[...nextauth].ts");
  if (recommendedAuthPaths.length === 0 && hasAuthLib) {
    recommendedAuthPaths.push("server/**/auth/**", "lib/auth/**");
  }
  return {
    projectType,
    hasMiddleware,
    hasAppRouter,
    hasAppApi,
    hasPagesApi,
    hasAuthLib,
    hasSupabaseAuth,
    hasNextAuth,
    existingPaths: normalized,
    recommendedAuthPaths
  };
}
function projectAwareRecommendation(input) {
  const { context, genericRecommendation, adapterId } = input;
  if (/middleware/i.test(genericRecommendation) && !context.hasMiddleware) {
    if (context.hasAppApi) {
      return genericRecommendation.replace(/middleware\.ts/gi, "app/api route handlers");
    }
    if (context.hasPagesApi) {
      return genericRecommendation.replace(/middleware\.ts/gi, "pages/api handlers");
    }
    return `Add server-side authentication checks in existing route handlers (${context.recommendedAuthPaths.join(", ") || "server entry points"}). Do not reference middleware.ts because this project does not include one.`;
  }
  if (/app\/api/i.test(genericRecommendation) && !context.hasAppApi && context.hasPagesApi) {
    return genericRecommendation.replace(/app\/api/g, "pages/api");
  }
  if (adapterId === "unauthenticated-endpoint" && context.projectType === "marketing_website") {
    return "Verify whether this route is intentionally public for a marketing site. If it must stay public, document the exception and add rate limiting.";
  }
  return genericRecommendation;
}

// brain/evidence-finding/rule-catalog.ts
var RULE_CATALOG = {
  "secrets.exposed": {
    ruleName: "Hard-coded secret",
    ruleDescription: "Detects credential-like values committed in source control.",
    category: "secrets",
    owasp: ["A02:2021 \u2013 Cryptographic Failures"],
    cwe: ["CWE-798: Use of Hard-coded Credentials"],
    mitreAttack: ["T1552.001"]
  },
  "secrets.public-env": {
    ruleName: "Secret exposed to client bundle",
    ruleDescription: "Client-prefixed environment variables are shipped to browsers.",
    category: "secrets",
    owasp: ["A02:2021 \u2013 Cryptographic Failures"],
    cwe: ["CWE-200: Exposure of Sensitive Information"]
  },
  "supabase.service-role-client": {
    ruleName: "Supabase service role in client code",
    ruleDescription: "Service-role keys bypass row-level security and must stay server-side.",
    category: "secrets",
    owasp: ["A01:2021 \u2013 Broken Access Control"],
    cwe: ["CWE-522: Insufficiently Protected Credentials"]
  },
  "auth.missing-route-guard": {
    ruleName: "Missing route authentication",
    ruleDescription: "Sensitive route handlers appear to accept unauthenticated requests.",
    category: "authentication",
    owasp: ["A01:2021 \u2013 Broken Access Control"],
    cwe: ["CWE-306: Missing Authentication for Critical Function"]
  },
  "idor-cross-tenant": {
    ruleName: "Cross-tenant data access",
    ruleDescription: "Resource access may not bind records to the authenticated tenant.",
    category: "authorization",
    owasp: ["A01:2021 \u2013 Broken Access Control"],
    cwe: ["CWE-639: Authorization Bypass Through User-Controlled Key"]
  },
  "unauthenticated-endpoint": {
    ruleName: "Unauthenticated endpoint",
    ruleDescription: "Protected route accepted a request without verified credentials.",
    category: "authentication",
    owasp: ["A01:2021 \u2013 Broken Access Control"],
    cwe: ["CWE-306: Missing Authentication for Critical Function"]
  }
};
function lookupRuleInfo(ruleId, fallbackTitle, category) {
  const known = RULE_CATALOG[ruleId];
  if (known) {
    return { ruleId, ...known };
  }
  return {
    ruleId,
    ruleName: fallbackTitle,
    category
  };
}

// brain/evidence-finding/compute-false-positive.ts
function computeFalsePositiveProbability(input) {
  let probability = 0.35;
  const reasons = [];
  const methodBase = {
    STATIC_ANALYSIS: 0.28,
    DYNAMIC_ANALYSIS: 0.18,
    REPLAY: 0.08,
    MOCK_SIMULATION: 0.32,
    AUTHORIZED_STAGING: 0.12,
    LIVE_VERIFICATION: 0.06,
    HYBRID: 0.15
  };
  probability = methodBase[input.detectionMethod];
  reasons.push(`${input.detectionMethod.replaceAll("_", " ").toLowerCase()} detections start with ${Math.round(probability * 100)}% false-positive prior.`);
  if (input.isSecretFinding) {
    if (input.hasProviderMatch) {
      probability -= 0.12;
      reasons.push("Provider pattern matched a known credential format.");
    }
    if (input.hasEntropySignal) {
      probability -= 0.08;
      reasons.push("High-entropy value pattern detected.");
    }
    if (!input.hasRuntimeUsage) {
      probability += 0.1;
      reasons.push("No runtime usage was observed for the credential.");
    }
  }
  if (input.projectType === "marketing_website" || input.projectType === "landing_page") {
    if (input.ruleId?.includes("auth") || input.ruleId?.includes("unauthenticated")) {
      probability += 0.25;
      reasons.push("Project classified as a public marketing site where public pages may be intentional.");
    }
  }
  probability -= Math.min(0.15, input.evidenceItems.length * 0.03);
  probability += Math.min(0.2, input.counterEvidenceItems.length * 0.05);
  if (input.hasRuntimeUsage) {
    probability -= 0.1;
    reasons.push("Runtime usage confirmed.");
  }
  probability = Math.min(0.95, Math.max(0.02, Number(probability.toFixed(3))));
  return {
    probability,
    explanation: reasons.join(" ")
  };
}
function falsePositivePercent(probability) {
  return Math.round(probability * 100);
}
function falsePositiveLabel(probability) {
  if (probability <= 0.1) return "Very Low";
  if (probability <= 0.25) return "Low";
  if (probability <= 0.45) return "Moderate";
  if (probability <= 0.65) return "Elevated";
  return "High";
}

// brain/evidence-finding/secret-evidence.ts
var PROVIDER_PATTERNS = [
  { provider: "OpenAI", pattern: /\bsk-[A-Za-z0-9]{10,}/, ruleId: "OPENAI_API_KEY" },
  { provider: "GitHub", pattern: /\bgh[oprsu]_[A-Za-z0-9_]{20,}/, ruleId: "GITHUB_TOKEN" },
  { provider: "AWS", pattern: /\bAKIA[A-Z0-9]{16}\b/, ruleId: "AWS_ACCESS_KEY_ID" },
  { provider: "Stripe", pattern: /\bsk_live_[A-Za-z0-9]{12,}/, ruleId: "STRIPE_SECRET_KEY" },
  { provider: "Supabase", pattern: /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i, ruleId: "SUPABASE_SERVICE_ROLE_KEY" }
];
function identifySecretProvider(input) {
  const haystack = `${input.evidence ?? ""} ${input.fingerprintMaterial ?? ""} ${input.ruleId ?? ""}`;
  for (const row of PROVIDER_PATTERNS) {
    const match = haystack.match(row.pattern);
    if (match) {
      const token = match[0];
      return {
        provider: row.provider,
        ruleId: row.ruleId,
        partialFingerprint: token.length > 8 ? `${token.slice(0, 3)}...${token.slice(-4)}` : "[REDACTED]"
      };
    }
  }
  const envMatch = haystack.match(/([A-Z0-9_]{3,})=\[REDACTED\]/);
  if (envMatch) {
    return {
      provider: inferProviderFromEnvName(envMatch[1]),
      ruleId: envMatch[1],
      partialFingerprint: envMatch[1]
    };
  }
  if (input.fingerprintMaterial && /^[A-Z0-9_]+$/.test(input.fingerprintMaterial)) {
    return {
      provider: inferProviderFromEnvName(input.fingerprintMaterial),
      ruleId: input.fingerprintMaterial,
      partialFingerprint: input.fingerprintMaterial
    };
  }
  return null;
}
function inferProviderFromEnvName(name) {
  const upper = name.toUpperCase();
  if (upper.includes("OPENAI")) return "OpenAI";
  if (upper.includes("GITHUB")) return "GitHub";
  if (upper.includes("AWS") || upper.startsWith("AKIA")) return "AWS";
  if (upper.includes("STRIPE")) return "Stripe";
  if (upper.includes("SUPABASE")) return "Supabase";
  if (upper.includes("ANTHROPIC")) return "Anthropic";
  return "Unknown provider";
}
function buildSecretEvidenceItems(input) {
  return [
    {
      id: "regex-match",
      kind: "regex_match",
      label: "Pattern matched",
      detail: `Rule ${input.ruleId} matched at ${input.filePath}:${input.line}.`,
      confidence: 0.85
    },
    {
      id: "provider",
      kind: "provider_identified",
      label: "Provider identified",
      detail: input.provider,
      confidence: 0.9
    },
    {
      id: "fingerprint",
      kind: "partial_fingerprint",
      label: "Partial fingerprint",
      detail: input.partialFingerprint,
      confidence: 0.8
    },
    {
      id: "location",
      kind: "file_location",
      label: "File location",
      detail: `${input.filePath}:${input.line}`,
      confidence: 1
    }
  ];
}
function secretRemediation(input) {
  return [
    `Revoke the ${input.provider} credential identified by rule ${input.ruleId}.`,
    `Remove the value from ${input.filePath} (line ${input.line}).`,
    `Rotate the secret using your ${input.provider} dashboard.`,
    `Load the new value from a secret manager instead of source control.`,
    `Reference fingerprint: ${input.partialFingerprint}.`
  ].join(" ");
}

// brain/repository-model/schema.ts
var CONFIDENCE_FINDING_THRESHOLD = 0.7;

// brain/repository-model/build-repository-model.ts
var ROUTE_PATTERNS = [
  /^app\/api\/.+\/route\.[jt]s$/,
  /^pages\/api\/.+\.[jt]s$/,
  /^server\/routes?\/.+\.[jt]s$/,
  /^src\/routes?\/.+\.[jt]s$/,
  /^routes?\/.+\.[jt]s$/
];
var AUTH_FILE_PATTERNS = [
  /(?:^|\/)middleware\.[jt]s$/,
  /(?:^|\/)auth\.[jt]s$/,
  /(?:^|\/)session\.[jt]s$/,
  /next-auth/i,
  /clerk/i,
  /lucia/i,
  /better-auth/i,
  /supabase.*auth/i
];
var PUBLIC_PAGE_PATTERNS = [
  /^app\/page\.[jt]sx?$/,
  /^pages\/index\.[jt]sx?$/,
  /^app\/\(marketing\)/,
  /^public\//
];
var PRIVATE_PAGE_PATTERNS = [
  /^app\/\(dashboard\)/,
  /^app\/dashboard/,
  /^pages\/dashboard/,
  /^app\/settings/
];
function detectPrimaryFramework(stack, paths) {
  const deps = Object.keys(stack.dependencies ?? {});
  const has = (name) => deps.includes(name) || stack.frameworks.includes(name);
  if (has("next") || paths.some((p2) => /^next\.config\./.test(p2))) return "nextjs";
  if (has("vite") || paths.some((p2) => p2 === "vite.config.ts" || p2 === "vite.config.js")) return "vite";
  if (has("@angular/core")) return "angular";
  if (has("vue")) return "vue";
  if (has("@nestjs/core")) return "nest";
  if (has("fastify")) return "fastify";
  if (has("express")) return "express";
  if (has("react") || has("react-dom")) return "react_spa";
  if (paths.some((p2) => /Gemfile/.test(p2))) return "rails";
  if (paths.some((p2) => /manage\.py/.test(p2))) return "django";
  if (paths.some((p2) => /\.csproj$/.test(p2))) return "aspnet";
  if (paths.some((p2) => /pom\.xml/.test(p2) || /build\.gradle/.test(p2))) return "spring";
  if (paths.length <= 5 && paths.every((p2) => /\.html?$/.test(p2))) return "static";
  return "unknown";
}
function buildRepositoryModel(files, stack) {
  const paths = files.map((file2) => file2.path.replace(/\\/g, "/"));
  const projectContext = analyzeProjectContext(paths);
  const framework = detectPrimaryFramework(stack, paths);
  const routeFiles = paths.filter((path) => ROUTE_PATTERNS.some((re) => re.test(path)));
  const authFiles = paths.filter((path) => AUTH_FILE_PATTERNS.some((re) => re.test(path)));
  const publicPages = paths.filter((path) => PUBLIC_PAGE_PATTERNS.some((re) => re.test(path)));
  const privatePages = paths.filter((path) => PRIVATE_PAGE_PATTERNS.some((re) => re.test(path)));
  const hasAppApi = paths.some((p2) => /^app\/api\//.test(p2));
  const hasPagesApi = paths.some((p2) => /^pages\/api\//.test(p2));
  const hasExpressRoutes = paths.some(
    (p2) => /^(?:server\/|src\/)?(?:routes?|api)\/.+\.[jt]s$/.test(p2)
  );
  const hasApiSurface = routeFiles.length > 0 || hasAppApi || hasPagesApi || hasExpressRoutes;
  const hasAuthLibrary = projectContext.hasAuthLib || projectContext.hasNextAuth || projectContext.hasSupabaseAuth || authFiles.length > 0;
  const hasJwtOrSession = files.some(
    (file2) => /jwt|session|getServerSession|getUser|auth\.getUser/i.test(file2.content)
  );
  const hasDatabase = stack.services.some(
    (s) => ["PostgreSQL", "MongoDB", "Supabase", "Prisma", "Firebase"].includes(s)
  );
  const hasOrm = stack.services.some((s) => ["Prisma"].includes(s));
  const hasProtectedRoutes = privatePages.length > 0 || paths.some((p2) => /\/dashboard|\/settings|\/admin/.test(p2));
  const hasPublicPagesOnly = projectContext.projectType === "marketing_website" || projectContext.projectType === "landing_page" || publicPages.length > 0 && !hasApiSurface && !hasProtectedRoutes;
  const hasWebhookHandlers = paths.some((p2) => /webhook/i.test(p2));
  const hasLlmIntegration2 = stack.dependencies?.openai != null || stack.dependencies?.["@anthropic-ai/sdk"] != null || paths.some((p2) => /\/rag\/|\/agents\/|\/llm\//.test(p2));
  return {
    version: 1,
    framework,
    stack,
    projectType: projectContext.projectType,
    paths,
    capabilities: {
      hasNextJs: framework === "nextjs",
      hasReact: stack.frameworks.includes("React"),
      hasVite: framework === "vite",
      hasExpress: framework === "express",
      hasFastify: framework === "fastify",
      hasNest: framework === "nest",
      hasAppRouter: projectContext.hasAppRouter,
      hasPagesRouter: paths.some((p2) => /^pages\//.test(p2)),
      hasAppApi,
      hasPagesApi,
      hasExpressRoutes,
      hasMiddleware: projectContext.hasMiddleware,
      hasAuthLibrary,
      hasJwtOrSession,
      hasDatabase,
      hasOrm,
      hasApiSurface,
      hasProtectedRoutes,
      hasPublicPagesOnly,
      hasWebhookHandlers,
      hasLlmIntegration: hasLlmIntegration2
    },
    routeFiles,
    authFiles,
    publicPages,
    privatePages
  };
}

// brain/prompts/analysis-engine-v2.ts
var NOT_ENOUGH_EVIDENCE = "NOT ENOUGH EVIDENCE";
function notEnoughEvidenceReason(detail) {
  return `${NOT_ENOUGH_EVIDENCE}: ${detail}`;
}

// brain/repository-model/finding-gate.ts
var AUTH_RULE_IDS = /* @__PURE__ */ new Set([
  "auth.missing",
  "authz.insufficient",
  "auth.missing-route-guard"
]);
var ROUTE_HEURISTIC_RULE_IDS = /* @__PURE__ */ new Set([
  "auth.missing",
  "authz.insufficient",
  "validation.missing",
  "rate-limit.missing"
]);
function validateFindingAgainstRepository(finding, model, evidenceReport) {
  const ruleId = finding.ruleId.toLowerCase();
  if (ROUTE_HEURISTIC_RULE_IDS.has(ruleId)) {
    if (!model.capabilities.hasApiSurface) {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "No API or route handlers exist in this repository \u2014 authentication finding not applicable."
        )
      };
    }
    if (model.capabilities.hasPublicPagesOnly && !model.capabilities.hasProtectedRoutes) {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "Project appears to be a public/static site without protected routes."
        )
      };
    }
  }
  if (AUTH_RULE_IDS.has(ruleId)) {
    const requiresAuthInfrastructure = model.capabilities.hasProtectedRoutes || model.capabilities.hasAuthLibrary || model.capabilities.hasMiddleware;
    if (!requiresAuthInfrastructure && !model.capabilities.hasApiSurface) {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "No authentication architecture or protected endpoints detected \u2014 cannot assert missing auth."
        )
      };
    }
    if (model.capabilities.hasPublicPagesOnly && finding.confidence === "low") {
      return {
        allowed: false,
        reason: notEnoughEvidenceReason(
          "Low-confidence auth heuristic suppressed for public website."
        )
      };
    }
  }
  if (ruleId.includes("middleware") && !model.capabilities.hasMiddleware && !model.capabilities.hasNextJs) {
    return {
      allowed: false,
      reason: notEnoughEvidenceReason("Project has no middleware layer.")
    };
  }
  const confidence = evidenceReport?.confidence ?? confidenceFromLabel(finding.confidence);
  const hasRequiredEvidence = Boolean(
    finding.location?.path && finding.location.line && (finding.evidence || finding.description || (evidenceReport?.evidence.length ?? 0) > 0 || evidenceReport?.reasoning)
  );
  if (!hasRequiredEvidence) {
    return {
      allowed: false,
      reason: notEnoughEvidenceReason("File, line, and proof are required.")
    };
  }
  const secretClassification = resolveSecretClassification({
    ruleId: finding.ruleId,
    filePath: finding.location?.path ?? null,
    evidence: finding.evidence ?? null,
    metadata: finding.metadata ?? null
  });
  if (secretClassification && isNonBlockingSecretClassification(secretClassification)) {
    return {
      allowed: true,
      classification: "potential_observation",
      evidenceReport: evidenceReport ?? void 0
    };
  }
  const securityAnalysis = finding.metadata?.securityAnalysis;
  if (securityAnalysis?.verificationStatus && securityAnalysis.verificationStatus !== "CONFIRMED") {
    return {
      allowed: true,
      classification: "potential_observation",
      evidenceReport: evidenceReport ?? void 0
    };
  }
  const classification = confidence >= CONFIDENCE_FINDING_THRESHOLD ? finding.severity === "critical" || finding.severity === "high" ? "production_blocker" : "confirmed_finding" : "potential_observation";
  if (evidenceReport && evidenceReport.confidence < CONFIDENCE_FINDING_THRESHOLD) {
    return {
      allowed: true,
      classification: "potential_observation",
      evidenceReport: {
        ...evidenceReport,
        statusLabel: "Potential observation \u2014 insufficient evidence",
        confirmationStatus: "potential_vulnerability"
      }
    };
  }
  return { allowed: true, classification, evidenceReport: evidenceReport ?? void 0 };
}
function confidenceFromLabel(confidence) {
  if (confidence === "high") return 0.85;
  if (confidence === "medium") return 0.65;
  if (confidence === "low") return 0.4;
  return 0.55;
}
function gateScanFindings(findings, model) {
  const accepted = [];
  const discarded = [];
  for (const finding of findings) {
    const report = finding.metadata?.evidenceReport;
    const result = validateFindingAgainstRepository(finding, model, report ?? null);
    if (!result.allowed) {
      discarded.push({ finding, reason: result.reason });
      continue;
    }
    const metadata = {
      ...finding.metadata ?? {},
      findingClassification: result.classification,
      ...result.evidenceReport ? { evidenceReport: result.evidenceReport } : {}
    };
    const secretClassification = resolveSecretClassification({
      ruleId: finding.ruleId,
      filePath: finding.location?.path ?? null,
      evidence: finding.evidence ?? null,
      metadata: finding.metadata ?? null
    });
    const isFixture = isNonBlockingSecretClassification(secretClassification);
    if (result.classification === "potential_observation") {
      accepted.push({
        ...finding,
        title: isFixture || finding.title.startsWith("Potential:") ? finding.title : `Potential: ${finding.title}`,
        severity: isFixture ? "info" : finding.severity === "critical" ? "high" : finding.severity,
        confidence: isFixture ? "low" : finding.confidence,
        metadata
      });
    } else {
      accepted.push({ ...finding, metadata });
    }
  }
  return { accepted, discarded };
}

// brain/evidence-finding/enrich-scan-finding.ts
function shouldSuppressPublicWebsiteFinding(finding, context) {
  if (context.projectType !== "marketing_website" && context.projectType !== "landing_page") {
    return false;
  }
  const haystack = `${finding.ruleId} ${finding.title} ${finding.category}`.toLowerCase();
  return haystack.includes("unauthenticated") || haystack.includes("missing auth") || haystack.includes("missing-auth") || haystack.includes("public endpoint");
}
function enrichScanFinding(input) {
  if (isPlatformInjectionFinding(input.finding)) {
    const report2 = buildScanEvidenceReport(input.finding, input.projectContext);
    const confidenceLevel = derivePlatformInjectionConfidenceLevel();
    return {
      ...input.finding,
      confidence: legacyBandFromConfidenceLevel(confidenceLevel),
      metadata: {
        ...input.finding.metadata ?? {},
        [EVIDENCE_REPORT_METADATA_KEY]: {
          ...report2,
          confidenceLevel,
          confidence: Math.min(report2.confidence, 0.35),
          confidencePercent: Math.min(report2.confidencePercent, 35),
          confirmationStatus: "UNVERIFIED",
          confidenceExplanation: "Platform guard detected a prompt injection attempt in untrusted repository content. This signal cannot upgrade other findings."
        }
      }
    };
  }
  if (shouldSuppressPublicWebsiteFinding(input.finding, input.projectContext)) {
    return {
      ...input.finding,
      metadata: {
        ...input.finding.metadata ?? {},
        suppressed: true,
        suppressionReason: "public_website_intentional_access",
        [EVIDENCE_REPORT_METADATA_KEY]: buildSuppressedReport(input.finding, input.projectContext)
      }
    };
  }
  const existingReport = readExistingEvidenceReport(input.finding);
  if (existingReport && isExternalSecurityAnalysisFinding(input.finding)) {
    return {
      ...input.finding,
      remediation: input.finding.category === "secrets" ? buildSecretRemediation(input.finding) : projectAwareRecommendation({
        genericRecommendation: input.finding.remediation,
        context: input.projectContext,
        adapterId: input.finding.ruleId
      }),
      metadata: {
        ...input.finding.metadata ?? {},
        [EVIDENCE_REPORT_METADATA_KEY]: existingReport
      }
    };
  }
  const report = buildScanEvidenceReport(input.finding, input.projectContext);
  const remediation = input.finding.category === "secrets" ? buildSecretRemediation(input.finding) : projectAwareRecommendation({
    genericRecommendation: input.finding.remediation,
    context: input.projectContext,
    adapterId: input.finding.ruleId
  });
  return {
    ...input.finding,
    remediation,
    metadata: {
      ...input.finding.metadata ?? {},
      [EVIDENCE_REPORT_METADATA_KEY]: report
    }
  };
}
function buildSecretRemediation(finding) {
  const secret = identifySecretProvider({
    evidence: finding.evidence,
    ruleId: finding.ruleId,
    fingerprintMaterial: typeof finding.metadata?.fingerprintMaterial === "string" ? finding.metadata.fingerprintMaterial : void 0
  });
  if (!secret) return finding.remediation;
  return secretRemediation({
    provider: secret.provider,
    ruleId: secret.ruleId,
    filePath: finding.location.path,
    line: finding.location.line,
    partialFingerprint: secret.partialFingerprint
  });
}
function buildSuppressedReport(finding, context) {
  return {
    version: 1,
    detectionMethod: "STATIC_ANALYSIS",
    confidence: 0.2,
    confidenceLevel: "SPECULATIVE",
    confidencePercent: 20,
    confidenceExplanation: "Finding suppressed because the project appears to be a public marketing site.",
    falsePositiveProbability: 0.85,
    falsePositivePercent: 85,
    falsePositiveExplanation: "Public pages returning HTTP 200 are expected for marketing websites.",
    confirmationStatus: "suppressed",
    statusLabel: "Suppressed \u2014 likely intentional public access",
    evidence: [],
    counterEvidence: [
      {
        id: "project-type",
        kind: "project_classification",
        label: "Project classified as public website",
        detail: context.projectType
      }
    ],
    reasoning: `This ${finding.title} finding was suppressed because SequrAI classified the repository as a ${context.projectType.replaceAll("_", " ")} where public routes are often intentional.`,
    affectedFiles: [{ path: finding.location.path, line: finding.location.line, matchedRule: finding.ruleId }],
    matchedRules: [lookupRuleInfo(finding.ruleId, finding.title, finding.category)],
    projectType: context.projectType
  };
}
function readExistingEvidenceReport(finding) {
  const report = finding.metadata?.[EVIDENCE_REPORT_METADATA_KEY];
  return report && typeof report === "object" ? report : void 0;
}
function isExternalSecurityAnalysisFinding(finding) {
  const securityAnalysis = finding.metadata?.securityAnalysis;
  if (securityAnalysis && typeof securityAnalysis === "object") {
    return true;
  }
  return finding.ruleId.startsWith("agent-scanner.") || finding.ruleId.startsWith("dependencies.") || finding.ruleId.endsWith(".security") || finding.ruleId.includes("package-security");
}
function buildScanEvidenceReport(finding, context) {
  const rule = lookupRuleInfo(finding.ruleId, finding.title, finding.category);
  const evidenceItems = buildStaticEvidenceItems(finding);
  const counterEvidence = buildStaticCounterEvidence(finding, context);
  const secretClassification = finding.metadata?.[SECRET_CLASSIFICATION_METADATA_KEY];
  const isSecret = finding.category === "secrets";
  const secret = isSecret ? identifySecretProvider({
    evidence: finding.evidence,
    ruleId: finding.ruleId,
    fingerprintMaterial: typeof finding.metadata?.fingerprintMaterial === "string" ? finding.metadata.fingerprintMaterial : void 0
  }) : null;
  if (secretClassification && isNonBlockingSecretClassification(secretClassification)) {
    counterEvidence.push({
      id: "secret-classification",
      kind: "secret_classification",
      label: "Secret classification",
      detail: secretClassification,
      confidence: 0.9
    });
  }
  if (secret && !isNonBlockingSecretClassification(secretClassification)) {
    evidenceItems.push(...buildSecretEvidenceItems({
      provider: secret.provider,
      ruleId: secret.ruleId,
      filePath: finding.location.path,
      line: finding.location.line,
      partialFingerprint: secret.partialFingerprint,
      regexMatched: true
    }));
  }
  const { confidence, explanation } = computeConfidenceScore({
    detectionMethod: "STATIC_ANALYSIS",
    evidenceItems,
    severity: finding.severity,
    hasRuntimeEvidence: false,
    hasReplayEvidence: false
  });
  const reasoning = buildScanReasoning(finding, evidenceItems, secret, secretClassification);
  const nonBlockingSecret = isNonBlockingSecretClassification(secretClassification);
  const externalFinding = isExternalSecurityAnalysisFinding(finding);
  const adjustedConfidence = nonBlockingSecret ? Math.min(confidence, 0.35) : confidence;
  const verificationStatusForConfidence = externalFinding || nonBlockingSecret ? "POTENTIAL" : adjustedConfidence >= 0.75 ? "CONFIRMED" : "POTENTIAL";
  const { level: confidenceLevel } = deriveConfidenceFromEvidenceScore({
    detectionMethod: "STATIC_ANALYSIS",
    evidenceItems,
    severity: finding.severity,
    hasRuntimeEvidence: false,
    hasReplayEvidence: false,
    verificationStatus: verificationStatusForConfidence,
    suppressed: false,
    llmOnly: externalFinding
  });
  const { probability, explanation: fpExplanation } = computeFalsePositiveProbability({
    detectionMethod: "STATIC_ANALYSIS",
    evidenceItems,
    counterEvidenceItems: counterEvidence,
    projectType: context.projectType,
    ruleId: finding.ruleId,
    isSecretFinding: isSecret,
    hasProviderMatch: Boolean(secret),
    hasEntropySignal: isSecret,
    hasRuntimeUsage: false
  });
  const confirmation = externalFinding ? {
    confirmationStatus: "potential_vulnerability",
    statusLabel: "Potential issue \u2014 external scanner signal pending verification"
  } : nonBlockingSecret ? {
    confirmationStatus: "not_exploitable",
    statusLabel: "Test fixture \u2014 no production action required"
  } : confidence >= 0.75 ? {
    confirmationStatus: "confirmed",
    statusLabel: "Confirmed by static analysis"
  } : {
    confirmationStatus: "potential_vulnerability",
    statusLabel: "Potential issue \u2014 review evidence"
  };
  return {
    version: 1,
    detectionMethod: "STATIC_ANALYSIS",
    confidence: adjustedConfidence,
    confidenceLevel,
    confidencePercent: confidencePercent(adjustedConfidence),
    confidenceExplanation: nonBlockingSecret ? "SequrAI classified this value as a test fixture or placeholder rather than a production credential." : externalFinding ? "External security scanner signal \u2014 SequrAI requires verification before treating this as confirmed." : explanation,
    falsePositiveProbability: nonBlockingSecret ? Math.max(probability, 0.8) : probability,
    falsePositivePercent: falsePositivePercent(nonBlockingSecret ? Math.max(probability, 0.8) : probability),
    falsePositiveExplanation: nonBlockingSecret ? "Likely test fixture \u2014 does not block production readiness." : `${falsePositiveLabel(probability)} \u2014 ${fpExplanation}`,
    confirmationStatus: confirmation.confirmationStatus,
    statusLabel: confirmation.statusLabel,
    evidence: evidenceItems,
    counterEvidence,
    reasoning,
    affectedFiles: [
      {
        path: finding.location.path,
        line: finding.location.line,
        column: finding.location.column,
        matchedRule: finding.ruleId
      }
    ],
    matchedRules: [rule],
    verificationStatus: "Not runtime verified",
    recommendedFix: isSecret ? buildSecretRemediation(finding) : projectAwareRecommendation({
      genericRecommendation: finding.remediation,
      context,
      adapterId: finding.ruleId
    }),
    safeFixConfidence: Math.min(0.92, confidence + 0.05),
    projectType: context.projectType
  };
}
function buildStaticEvidenceItems(finding) {
  const items = [
    {
      id: "static-rule",
      kind: "static_rule_match",
      label: "Static rule matched",
      detail: `${finding.ruleId} at ${finding.location.path}:${finding.location.line}`,
      confidence: finding.confidence === "high" ? 0.85 : finding.confidence === "medium" ? 0.65 : 0.45
    }
  ];
  if (finding.evidence) {
    items.push({
      id: "snippet",
      kind: "code_evidence",
      label: "Matched pattern",
      detail: finding.evidence,
      confidence: 0.7
    });
  }
  return items;
}
function buildStaticCounterEvidence(finding, context) {
  const items = [];
  if (/example|sample|test|mock|fixture/i.test(finding.location.path)) {
    items.push({
      id: "test-path",
      kind: "test_file",
      label: "Match in test or example path",
      detail: finding.location.path
    });
  }
  if (context.projectType === "marketing_website") {
    items.push({
      id: "public-site",
      kind: "project_classification",
      label: "Public website classification",
      detail: "Some routes may intentionally be public."
    });
  }
  if (finding.category === "secrets" && !finding.evidence?.includes("sk_")) {
    items.push({
      id: "no-runtime",
      kind: "missing_runtime_usage",
      label: "No runtime usage observed",
      detail: "Static match only \u2014 credential may be inactive."
    });
  }
  return items;
}
function buildScanReasoning(finding, evidence, secret, secretClassification) {
  if (secretClassification === "TEST_FIXTURE") {
    return `SequrAI matched a credential-like assignment in ${finding.location.path}:${finding.location.line}, but the value appears to be a test fixture based on file context, naming, and nearby test code. It should not block production readiness.`;
  }
  if (secretClassification === "PLACEHOLDER") {
    return `SequrAI matched a credential-like assignment in ${finding.location.path}:${finding.location.line}, but the value reads like a placeholder rather than a live credential. Confirm it is not used in production.`;
  }
  if (secretClassification === "FALSE_POSITIVE") {
    return `SequrAI matched a credential-like pattern in ${finding.location.path}:${finding.location.line}, but the assigned value is not a literal secret.`;
  }
  if (secret) {
    return `SequrAI matched rule ${secret.ruleId} for ${secret.provider} at ${finding.location.path}:${finding.location.line}. The pattern, provider format, and file location align with a committed credential (${secret.partialFingerprint}).`;
  }
  return `SequrAI matched static rule ${finding.ruleId} in ${finding.location.path} at line ${finding.location.line}. ${evidence.length} evidence item(s) support this conclusion. Review counter-evidence before acting.`;
}
function postProcessScanFindings(findings, filePaths, normalizedFiles) {
  const context = analyzeProjectContext(filePaths);
  const model = normalizedFiles != null ? buildRepositoryModel(normalizedFiles, detectStack([...normalizedFiles])) : buildRepositoryModel(
    filePaths.map((path) => stubNormalizedFile(path)),
    detectStack([])
  );
  const platformFindings = collectPlatformInjectionFindings(findings, normalizedFiles);
  const seenFingerprints = /* @__PURE__ */ new Set();
  const combined = [...findings, ...platformFindings].filter((finding) => {
    if (seenFingerprints.has(finding.fingerprint)) return false;
    seenFingerprints.add(finding.fingerprint);
    return true;
  });
  const enriched = combined.map((finding) => enrichScanFinding({ finding, projectContext: context, repositoryModel: model })).filter((finding) => !finding.metadata?.suppressed);
  const { accepted } = gateScanFindings(enriched, model);
  return accepted;
}

// features/security-scanner/scanner.ts
var RULE_CONCURRENCY = 4;
async function scanRepository(files, options = {}) {
  const config2 = resolveConfig(options);
  const startedAt = config2.now();
  const normalized = normalizeFiles([...files], config2);
  const stack = detectStack(normalized.files);
  const omissions = [...normalized.omissions];
  const registry2 = options.registry ?? createDefaultRegistry();
  const drafts = [];
  let rulesRun = 0;
  let ruleFailures = 0;
  let timeLimited = false;
  const byPath = new Map(normalized.files.map((file2) => [file2.path, file2]));
  const shared = createScanSharedContext(normalized.files, { includeDev: true });
  const context = {
    files: normalized.files,
    stack,
    getFile: (path) => byPath.get(path),
    shared
  };
  const rules = registry2.list();
  for (let index = 0; index < rules.length; index += RULE_CONCURRENCY) {
    if (config2.now() - startedAt >= config2.maxDurationMs) {
      omissions.push({
        reason: "time-limit",
        detail: `Stopped before rule batch starting at ${rules[index]?.id ?? "unknown"}`
      });
      timeLimited = true;
      break;
    }
    const batch = rules.slice(index, index + RULE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (rule) => {
        if (config2.now() - startedAt >= config2.maxDurationMs) {
          return { rule, output: [], error: null, skipped: true };
        }
        try {
          const output = await rule.run(context);
          return { rule, output, error: null, skipped: false };
        } catch (error51) {
          return {
            rule,
            output: [],
            error: error51 instanceof Error ? error51 : new Error("Unknown rule error"),
            skipped: false
          };
        }
      })
    );
    for (const result of results) {
      if (result.skipped) {
        timeLimited = true;
        continue;
      }
      if (result.error) {
        ruleFailures += 1;
        omissions.push({
          reason: "rule-error",
          ruleId: result.rule.id,
          detail: result.error.name
        });
        continue;
      }
      drafts.push(...result.output);
      rulesRun += 1;
    }
    if (timeLimited) {
      break;
    }
  }
  const allFindings = drafts.map(finalizeFinding);
  const deduped = deduplicateFindings(allFindings);
  const findings = postProcessScanFindings(
    deduped,
    normalized.files.map((file2) => file2.path),
    normalized.files
  );
  const durationMs = Math.max(0, config2.now() - startedAt);
  return {
    findings,
    stack,
    score: scoreFindings(findings),
    omissions,
    metrics: {
      inputFiles: files.length,
      scannedFiles: normalized.files.length,
      scannedBytes: normalized.bytes,
      omittedFiles: normalized.omissions.length,
      rulesRun,
      ruleFailures,
      findingsBeforeDeduplication: allFindings.length,
      findings: findings.length,
      durationMs,
      truncated: normalized.truncated || timeLimited
    }
  };
}
function finalizeFinding(draft) {
  const material = draft.fingerprintMaterial ?? draft.title;
  const fingerprint = findingFingerprint(
    draft.ruleId,
    draft.location.path,
    draft.location.line,
    material
  );
  const correlationKey = buildFindingCorrelationKey({
    ruleId: draft.ruleId,
    filePath: draft.location.path,
    fingerprintMaterial: material
  });
  const { fingerprintMaterial: _discarded, ...finding } = draft;
  return {
    ...finding,
    id: `${draft.ruleId}:${fingerprint}`,
    fingerprint,
    correlationKey,
    metadata: {
      ...draft.metadata ?? {},
      correlationKey,
      correlationMaterial: material
    },
    evidence: draft.evidence ? redactEvidence(draft.evidence) : void 0
  };
}
function deduplicateFindings(findings) {
  const unique = /* @__PURE__ */ new Map();
  const ordered = [...findings].sort(
    (a, b) => a.location.path.localeCompare(b.location.path) || a.location.line - b.location.line || a.ruleId.localeCompare(b.ruleId)
  );
  for (const finding of ordered) {
    const nearbyDuplicate = [...unique.values()].some(
      (existing) => existing.ruleId === finding.ruleId && existing.title === finding.title && existing.location.path === finding.location.path && Math.abs(existing.location.line - finding.location.line) <= 1
    );
    if (!nearbyDuplicate && !unique.has(finding.fingerprint)) {
      unique.set(finding.fingerprint, finding);
    }
  }
  return [...unique.values()].sort(
    (a, b) => a.location.path.localeCompare(b.location.path) || a.location.line - b.location.line || a.ruleId.localeCompare(b.ruleId)
  );
}

// lib/local-analysis/constants.ts
import { randomUUID } from "node:crypto";
var LOCAL_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
var LOCAL_REPOSITORY_ID = "00000000-0000-4000-8000-000000000002";
function createLocalScanId() {
  return randomUUID();
}

// lib/local-analysis/git-scope.ts
import { execFileSync } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { join } from "node:path";

// lib/local-analysis/workspace.ts
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename as basename5, dirname as dirname2, relative, resolve, sep } from "node:path";
var WorkspaceBoundaryError = class extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "WorkspaceBoundaryError";
    this.code = code;
  }
};
var DEFAULT_IGNORED_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "target",
  ".cache",
  ".turbo",
  ".vercel"
]);
var LOCAL_SCAN_LIMITS = {
  maxFiles: 8e3,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxDepth: 18
};
var MAX_FILE_BYTES = LOCAL_SCAN_LIMITS.maxFileBytes;
var MAX_TOTAL_BYTES = LOCAL_SCAN_LIMITS.maxTotalBytes;
var MAX_FILES = LOCAL_SCAN_LIMITS.maxFiles;
var MAX_DEPTH = LOCAL_SCAN_LIMITS.maxDepth;
var CREDENTIAL_BASENAME_PATTERNS = [
  /^\.env$/i,
  /^\.env\.(?!example$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /credentials/i,
  /secrets?/i,
  /service-account.*\.json$/i
];
function isCredentialDeniedBasename(name) {
  const base = basename5(name);
  return CREDENTIAL_BASENAME_PATTERNS.some((pattern) => pattern.test(base));
}
function decodePathSegment(input) {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}
function normalizeWorkspaceRoot(input) {
  const root = resolve(input ?? process.cwd());
  if (!existsSync(root)) {
    throw new WorkspaceBoundaryError("workspace_not_found");
  }
  const stat = lstatSync(root);
  if (!stat.isDirectory()) {
    throw new WorkspaceBoundaryError("workspace_not_directory");
  }
  return root;
}
function realpathResolved(path) {
  try {
    return realpathSync.native(path);
  } catch (error51) {
    const err = error51;
    if (err.code === "ENOENT") {
      const parent = dirname2(path);
      if (parent === path) {
        throw new WorkspaceBoundaryError("workspace_not_found");
      }
      return resolve(realpathResolved(parent), basename5(path));
    }
    throw error51;
  }
}
function isDescendantPath(root, target) {
  const normalizedRoot = root.endsWith(sep) ? root.slice(0, -1) : root;
  const normalizedTarget = target.endsWith(sep) ? target.slice(0, -1) : target;
  if (normalizedTarget === normalizedRoot) return true;
  return normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}
function resolveAuthorizedWorkspacePath(authorizedRoot, requestedPath) {
  const root = normalizeWorkspaceRoot(authorizedRoot);
  const rootReal = realpathResolved(root);
  if (!requestedPath?.trim()) {
    return rootReal;
  }
  const decoded = decodePathSegment(requestedPath.trim());
  if (decoded.includes("\0")) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }
  const segments = decoded.split(/[/\\]+/).filter(Boolean);
  for (const segment of segments) {
    assertPathComponentSafe(segment);
  }
  const isAbsolute = decoded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(decoded);
  const candidate = isAbsolute ? resolve(decoded) : resolve(rootReal, decoded);
  const candidateReal = realpathResolved(candidate);
  if (!isDescendantPath(rootReal, candidateReal)) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }
  if (!existsSync(candidateReal)) {
    throw new WorkspaceBoundaryError("workspace_not_found");
  }
  const stat = lstatSync(candidateReal);
  if (!stat.isDirectory()) {
    throw new WorkspaceBoundaryError("workspace_not_directory");
  }
  return candidateReal;
}
function assertPathComponentSafe(component) {
  const decoded = decodePathSegment(component);
  if (decoded === ".." || decoded.includes("\0") || decoded.includes("/") || decoded.includes("\\")) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }
}
function resolveSafePath(workspaceRoot, candidatePath) {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  if (!candidatePath) return root;
  const decoded = decodePathSegment(candidatePath);
  const segments = decoded.split(/[/\\]+/).filter(Boolean);
  for (const segment of segments) {
    assertPathComponentSafe(segment);
  }
  const target = resolve(root, ...segments);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new WorkspaceBoundaryError("workspace_path_not_authorized");
  }
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw new Error("symlink_not_allowed");
    }
  }
  return target;
}
function parseIgnoreLines(content) {
  return content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}
function loadIgnorePatterns(workspaceRoot) {
  const patterns = [];
  for (const fileName of [".gitignore", ".sequraiignore"]) {
    const filePath = resolveSafePath(workspaceRoot, fileName);
    if (!existsSync(filePath)) continue;
    patterns.push(...parseIgnoreLines(readFileSync(filePath, "utf8")));
  }
  return patterns;
}
function pathMatchesPattern(relativePath, pattern) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (pattern.endsWith("/")) {
    return normalized.split("/").includes(pattern.slice(0, -1));
  }
  if (pattern.includes("*")) {
    const regex = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\xA7\xA7").replace(/\*/g, "[^/]*").replace(/§§/g, ".*")}$`
    );
    return regex.test(normalized);
  }
  return normalized === pattern || normalized.endsWith(`/${pattern}`);
}
function isIgnoredRelativePath(relativePath, workspaceRoot) {
  const normalized = relativePath.replace(/\\/g, "/");
  const firstSegment = normalized.split("/")[0];
  if (DEFAULT_IGNORED_DIRS.has(firstSegment)) {
    return true;
  }
  if (isCredentialDeniedBasename(normalized)) {
    return true;
  }
  for (const pattern of loadIgnorePatterns(workspaceRoot)) {
    if (pathMatchesPattern(normalized, pattern)) {
      return true;
    }
  }
  return false;
}
function isBinaryBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}
function listWorkspaceFiles(workspaceRoot, options = {}) {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const files = [];
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  let totalBytes = 0;
  let filesExcluded = 0;
  let credentialsSkipped = 0;
  let discoveredFiles = 0;
  let truncated = false;
  function recordExcluded(relativePath) {
    filesExcluded += 1;
    if (isCredentialDeniedBasename(relativePath)) {
      credentialsSkipped += 1;
    }
  }
  function walk(currentDir, depth) {
    if (files.length >= maxFiles) {
      truncated = true;
      return;
    }
    if (depth > maxDepth) {
      truncated = true;
      filesExcluded += 1;
      return;
    }
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const absolutePath = resolve(currentDir, entry.name);
      const rel = relative(root, absolutePath).replace(/\\/g, "/");
      if (!rel || rel.startsWith("..")) continue;
      if (entry.isSymbolicLink()) {
        filesExcluded += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (isIgnoredRelativePath(`${rel}/`, root)) {
          recordExcluded(`${rel}/`);
          continue;
        }
        walk(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      discoveredFiles += 1;
      if (isIgnoredRelativePath(rel, root)) {
        recordExcluded(rel);
        continue;
      }
      if (options.onlyRelativePaths && !options.onlyRelativePaths.has(rel)) {
        continue;
      }
      let stat;
      try {
        stat = lstatSync(absolutePath);
      } catch {
        filesExcluded += 1;
        continue;
      }
      if (stat.isSymbolicLink()) {
        filesExcluded += 1;
        continue;
      }
      if (stat.size > maxFileBytes) {
        filesExcluded += 1;
        truncated = true;
        continue;
      }
      if (totalBytes + stat.size > maxTotalBytes) {
        truncated = true;
        break;
      }
      totalBytes += stat.size;
      files.push({ relativePath: rel, absolutePath, size: stat.size });
    }
  }
  walk(root, 0);
  return {
    files,
    totalBytes,
    truncated,
    stats: {
      filesExcluded,
      credentialsSkipped,
      discoveredFiles
    }
  };
}
function readWorkspaceTextFile(workspaceRoot, relativePath) {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const safePath = resolveSafePath(root, relativePath);
  if (!existsSync(safePath) || !lstatSync(safePath).isFile()) {
    throw new Error("file_not_found");
  }
  const buffer = readFileSync(safePath);
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error("file_too_large");
  }
  if (isBinaryBuffer(buffer)) {
    throw new Error("binary_file");
  }
  return buffer.toString("utf8");
}

// lib/local-analysis/git-scope.ts
function runGit(workspaceRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}
function getGitContext(workspaceRoot) {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const insideGit = existsSync2(join(root, ".git"));
  if (!insideGit) {
    return {
      isGitRepository: false,
      branch: null,
      commitSha: null,
      status: null,
      diff: null,
      stagedDiff: null
    };
  }
  return {
    isGitRepository: true,
    branch: runGit(root, ["branch", "--show-current"]),
    commitSha: runGit(root, ["rev-parse", "HEAD"]),
    status: runGit(root, ["status", "--porcelain"]),
    diff: runGit(root, ["diff"]),
    stagedDiff: runGit(root, ["diff", "--cached"])
  };
}
function parseChangedFilesFromStatus(status) {
  if (!status) return [];
  const files = /* @__PURE__ */ new Set();
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const raw = line.slice(3).trim();
    if (!raw) continue;
    const path = raw.includes(" -> ") ? raw.split(" -> ").pop().trim() : raw;
    files.add(path.replace(/\\/g, "/"));
  }
  return [...files];
}
function parseGitFileCounts(status) {
  if (!status) {
    return { modifiedFiles: 0, untrackedFiles: 0, deletedFiles: 0 };
  }
  let modifiedFiles = 0;
  let untrackedFiles = 0;
  let deletedFiles = 0;
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const indexCode = line.slice(0, 2);
    if (indexCode.includes("?")) {
      untrackedFiles += 1;
      continue;
    }
    if (indexCode.includes("D")) {
      deletedFiles += 1;
    }
    if (/M|A|R|C|T|U/.test(indexCode)) {
      modifiedFiles += 1;
    }
  }
  return { modifiedFiles, untrackedFiles, deletedFiles };
}
function parseChangedFilesFromDiff(diff) {
  if (!diff) return [];
  const files = /* @__PURE__ */ new Set();
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      const path = line.slice(6).trim();
      if (path !== "/dev/null") {
        files.add(path);
      }
    }
  }
  return [...files];
}
function resolveScopePaths(git, scope) {
  if (!git.isGitRepository) {
    if (scope === "workspace") {
      return { scope, paths: /* @__PURE__ */ new Set(), requiresGit: false };
    }
    return { scope, paths: /* @__PURE__ */ new Set(), requiresGit: true };
  }
  if (scope === "workspace") {
    return { scope, paths: /* @__PURE__ */ new Set(), requiresGit: false };
  }
  if (scope === "staged") {
    const paths2 = new Set(parseChangedFilesFromDiff(git.stagedDiff));
    return { scope, paths: paths2, requiresGit: false };
  }
  if (scope === "diff") {
    const paths2 = new Set(parseChangedFilesFromDiff(git.diff));
    return { scope, paths: paths2, requiresGit: false };
  }
  const paths = /* @__PURE__ */ new Set([
    ...parseChangedFilesFromStatus(git.status),
    ...parseChangedFilesFromDiff(git.diff),
    ...parseChangedFilesFromDiff(git.stagedDiff)
  ]);
  return { scope: "working_tree", paths, requiresGit: false };
}
function resolveScopeFromArgs(input) {
  if (input.gitDiffOnly) return "diff";
  return input.scope ?? "workspace";
}

// lib/local-analysis/map-findings.ts
function collectInputFiles(workspaceRoot, onlyRelativePaths) {
  const listing = listWorkspaceFiles(workspaceRoot, {
    onlyRelativePaths: onlyRelativePaths && onlyRelativePaths.size > 0 ? onlyRelativePaths : void 0
  });
  const files = [];
  for (const file2 of listing.files) {
    try {
      const content = readWorkspaceTextFile(workspaceRoot, file2.relativePath);
      files.push({ path: file2.relativePath, content });
    } catch {
      continue;
    }
  }
  return files;
}
function mapScanFindingToVerdictInput(finding) {
  return {
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    rule_id: finding.ruleId,
    file_path: finding.location.path,
    start_line: finding.location.line,
    recommendation: finding.remediation,
    confidence: finding.confidence,
    evidence: finding.evidence ?? null,
    metadata: finding.metadata ?? null
  };
}
function mapFindingToPublic(finding) {
  const safeToIgnore = isNonBlockingSecretFinding({
    ruleId: finding.ruleId,
    file_path: finding.location.path,
    evidence: finding.evidence ?? null,
    metadata: finding.metadata ?? null
  });
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    category: finding.category,
    filePath: finding.location.path,
    line: finding.location.line,
    correlationKey: finding.correlationKey,
    evidence: finding.evidence ? redactEvidence(finding.evidence) : void 0,
    remediation: finding.remediation,
    confidence: finding.confidence,
    safeToIgnore
  };
}
function mapFindingsToPublic(findings) {
  return findings.map(mapFindingToPublic);
}

// lib/local-analysis/format-local-response.ts
function buildLocalStatusSummary(input) {
  const lines = [
    "SEQURAI \u2014 Production Verdict (Local Workspace)",
    "",
    "SOURCE: Local workspace",
    `SCOPE: ${formatScopeLabel(input.scope)}`,
    "",
    "STATUS",
    input.headline ?? input.verdictStatus.toUpperCase()
  ];
  if (input.score != null) {
    lines.push(`SCORE: ${input.score}/100`);
  } else {
    lines.push("SCORE: unavailable (insufficient evidence for a numeric score)");
  }
  if (input.executiveSummary) {
    lines.push("", "SUMMARY", input.executiveSummary);
  }
  if (input.reason) {
    lines.push("", "NOTE", input.reason);
  }
  const actionable = input.findings.filter(
    (finding) => !finding.safeToIgnore && (finding.severity === "critical" || finding.severity === "high" || finding.severity === "medium")
  );
  if (actionable.length > 0) {
    lines.push("", "MAIN FINDINGS");
    for (const finding of actionable.slice(0, 6)) {
      lines.push(
        "",
        `${finding.severity.toUpperCase()} \u2014 ${finding.title}`,
        `File: ${finding.filePath}:${finding.line}`,
        finding.description
      );
      if (finding.evidence) {
        lines.push(`Evidence: ${finding.evidence}`);
      }
      lines.push(`What to do: ${finding.remediation}`);
    }
  }
  if (input.topPriorities && input.topPriorities.length > 0) {
    lines.push("", "TOP PRIORITIES");
    for (const priority of input.topPriorities) {
      lines.push(`- ${priority}`);
    }
  }
  const hasSecretFinding = actionable.some(
    (finding) => `${finding.title} ${finding.category} ${finding.ruleId}`.toLowerCase().match(/secret|credential|api key/)
  );
  if (hasSecretFinding) {
    lines.push("", "NEXT STEPS");
    lines.push("1. Review the highlighted values in your local workspace.");
    lines.push("2. Remove real credentials from source and rotate them if they were ever exposed.");
    lines.push("3. Re-run sequrai_local_audit after fixing.");
  } else if (actionable.length > 0) {
    lines.push("", "NEXT STEPS");
    lines.push("1. Address the findings above in your local workspace.");
    lines.push("2. Re-run sequrai_local_audit to verify.");
  }
  lines.push(
    "",
    "LIMITATION",
    "This verdict analyzes files on disk in your authorized workspace only. Remote MCP tools analyze your connected repository separately."
  );
  return lines.join("\n");
}
function formatScopeLabel(scope) {
  switch (scope) {
    case "workspace":
      return "Full workspace";
    case "working_tree":
      return "Working tree changes";
    case "staged":
      return "Staged changes";
    case "diff":
      return "Unstaged diff";
    default:
      return scope;
  }
}

// lib/local-analysis/run-local-verdict.ts
var MAX_INLINE_LOCAL_FINDINGS = 40;
var LOCAL_SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
};
function capLocalFindingsForResponse(findings) {
  if (findings.length <= MAX_INLINE_LOCAL_FINDINGS) return findings;
  return [...findings].sort((a, b) => (LOCAL_SEVERITY_RANK[a.severity] ?? 5) - (LOCAL_SEVERITY_RANK[b.severity] ?? 5)).slice(0, MAX_INLINE_LOCAL_FINDINGS);
}
function buildGitMetadata(git) {
  const counts = parseGitFileCounts(git.status);
  return {
    branch: git.branch,
    commitSha: git.commitSha,
    modifiedFiles: counts.modifiedFiles,
    untrackedFiles: counts.untrackedFiles,
    deletedFiles: counts.deletedFiles
  };
}
function buildInsufficientDataResult(input) {
  const scanId = createLocalScanId();
  const { verdict } = generateProductionVerdict({
    projectId: LOCAL_PROJECT_ID,
    repositoryId: LOCAL_REPOSITORY_ID,
    scanId,
    commitSha: input.git.commitSha,
    branch: input.git.branch,
    scanStatus: "completed",
    securityScore: null,
    filesAnalyzed: 0,
    filesDiscovered: input.snapshot.filesAnalyzed,
    findings: [],
    partialScanFailure: input.snapshot.truncated
  });
  return {
    source: "local",
    gitAvailable: input.git.isGitRepository,
    scope: input.scope,
    phase: input.snapshot.truncated ? "partial" : "complete",
    workspace: input.workspace,
    branch: input.git.branch,
    commitSha: input.git.commitSha,
    verdictStatus: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    findings: [],
    findingsOmittedCount: 0,
    productionVerdict: verdict,
    snapshot: input.snapshot,
    git: buildGitMetadata(input.git),
    scanMetrics: {
      inputFiles: 0,
      scannedFiles: 0,
      rulesRun: 0,
      truncated: input.snapshot.truncated
    },
    narrative: buildLocalStatusSummary({
      scope: input.scope,
      verdictStatus: verdict.status,
      score: verdict.score,
      findings: [],
      reason: input.reason
    }),
    methodologyNote: verdict.methodologyNote
  };
}
async function runLocalProductionVerdict(input = {}) {
  const workspace = normalizeWorkspaceRoot(input.workspacePath ?? process.cwd());
  const scope = resolveScopeFromArgs(input);
  const git = getGitContext(workspace);
  const listing = listWorkspaceFiles(workspace);
  const emptySnapshot = {
    filesAnalyzed: 0,
    filesExcluded: listing.stats.filesExcluded,
    bytesAnalyzed: 0,
    truncated: listing.truncated,
    credentialsSkipped: listing.stats.credentialsSkipped
  };
  const { scope: resolvedScope, paths, requiresGit } = resolveScopePaths(git, scope);
  if (requiresGit) {
    return buildInsufficientDataResult({
      workspace,
      scope,
      git,
      snapshot: emptySnapshot,
      reason: "Git is not available in this workspace. Use scope=workspace or initialize a git repository."
    });
  }
  if (resolvedScope !== "workspace" && paths.size === 0) {
    return buildInsufficientDataResult({
      workspace,
      scope: resolvedScope,
      git,
      snapshot: emptySnapshot,
      reason: "No changed files detected for the selected scope."
    });
  }
  const scopedListing = resolvedScope === "workspace" ? listing : listWorkspaceFiles(workspace, { onlyRelativePaths: paths });
  const inputFiles = collectInputFiles(
    workspace,
    resolvedScope === "workspace" ? void 0 : paths
  );
  if (inputFiles.length === 0) {
    return buildInsufficientDataResult({
      workspace,
      scope: resolvedScope,
      git,
      snapshot: {
        filesAnalyzed: 0,
        filesExcluded: scopedListing.stats.filesExcluded,
        bytesAnalyzed: 0,
        truncated: scopedListing.truncated,
        credentialsSkipped: scopedListing.stats.credentialsSkipped
      },
      reason: "No readable source files found inside the authorized workspace."
    });
  }
  const scan = await scanRepository(inputFiles);
  const scanId = createLocalScanId();
  const bytesAnalyzed = inputFiles.reduce((sum, file2) => sum + file2.content.length, 0);
  const snapshotTruncated = scopedListing.truncated || scan.metrics.truncated;
  const snapshot = {
    filesAnalyzed: scan.metrics.scannedFiles,
    filesExcluded: scopedListing.stats.filesExcluded,
    bytesAnalyzed,
    truncated: snapshotTruncated,
    credentialsSkipped: scopedListing.stats.credentialsSkipped
  };
  const { verdict } = generateProductionVerdict({
    projectId: LOCAL_PROJECT_ID,
    repositoryId: LOCAL_REPOSITORY_ID,
    scanId,
    commitSha: git.commitSha,
    branch: git.branch,
    scanStatus: "completed",
    securityScore: scan.score.score,
    filesAnalyzed: scan.metrics.scannedFiles,
    filesDiscovered: scopedListing.stats.discoveredFiles,
    findings: scan.findings.map(mapScanFindingToVerdictInput),
    partialScanFailure: snapshotTruncated
  });
  const publicFindings = mapFindingsToPublic(scan.findings);
  const actionableFindings = publicFindings.filter((finding) => !finding.safeToIgnore);
  const inlineFindings = capLocalFindingsForResponse(publicFindings);
  return {
    source: "local",
    gitAvailable: git.isGitRepository,
    scope: resolvedScope,
    phase: snapshotTruncated ? "partial" : "complete",
    workspace,
    branch: git.branch,
    commitSha: git.commitSha,
    verdictStatus: verdict.status,
    score: verdict.score,
    blockersCount: verdict.blockersCount,
    findings: inlineFindings,
    findingsOmittedCount: Math.max(0, publicFindings.length - inlineFindings.length),
    productionVerdict: verdict,
    snapshot,
    git: buildGitMetadata(git),
    scanMetrics: {
      inputFiles: scan.metrics.inputFiles,
      scannedFiles: scan.metrics.scannedFiles,
      rulesRun: scan.metrics.rulesRun,
      truncated: snapshotTruncated
    },
    narrative: buildLocalStatusSummary({
      scope: resolvedScope,
      verdictStatus: verdict.status,
      score: verdict.score,
      findings: actionableFindings,
      headline: verdictHeadline(verdict.status),
      executiveSummary: verdict.executiveSummary,
      topPriorities: verdict.topPriorities.map((priority) => priority.title)
    }),
    methodologyNote: verdict.methodologyNote,
    correlation: {
      ready: Boolean(git.commitSha),
      commitSha: git.commitSha,
      branch: git.branch,
      reason: git.commitSha ? void 0 : "Local analysis has no verified commit SHA for GitHub correlation."
    }
  };
}
function buildLocalWorkspaceStatus(workspacePath) {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  const listing = listWorkspaceFiles(workspace);
  const git = getGitContext(workspace);
  const gitMeta = buildGitMetadata(git);
  return {
    source: "local",
    gitAvailable: git.isGitRepository,
    workspace,
    branch: git.branch,
    commitSha: git.commitSha,
    isGitRepository: git.isGitRepository,
    gitStatus: git.status,
    git: gitMeta,
    snapshot: {
      filesAnalyzed: listing.files.length,
      filesExcluded: listing.stats.filesExcluded,
      bytesAnalyzed: listing.totalBytes,
      truncated: listing.truncated,
      credentialsSkipped: listing.stats.credentialsSkipped
    },
    filesCount: listing.files.length,
    totalBytes: listing.totalBytes,
    truncated: listing.truncated,
    analysisReadiness: listing.files.length > 0 ? "ready" : "empty",
    ignoredExamples: ["node_modules/", ".git/", ".env (credentials skipped)"]
  };
}
function buildLocalReview(input) {
  const workspace = normalizeWorkspaceRoot(input.workspacePath ?? process.cwd());
  const git = getGitContext(workspace);
  const scope = input.gitDiffOnly ? "diff" : "working_tree";
  const diff = input.gitDiffOnly ? git.diff : `${git.stagedDiff ?? ""}
${git.diff ?? ""}`.trim();
  return {
    source: "local",
    gitAvailable: git.isGitRepository,
    scope,
    branch: git.branch,
    git: buildGitMetadata(git),
    hasChanges: Boolean(git.status?.trim()),
    diffPreview: diff ? diff.slice(0, 4e3) : null,
    message: git.status?.trim() ? "Local changes detected. Use sequrai_local_audit or audit_local_project with scope working_tree, staged, or diff." : "No local changes detected."
  };
}
function buildLocalFindings(workspacePath) {
  return runLocalProductionVerdict({ workspacePath, scope: "workspace" }).then((result) => ({
    source: "local",
    scope: "workspace",
    findings: result.findings.filter(
      (finding) => finding.severity === "critical" || finding.severity === "high" || !finding.safeToIgnore
    )
  }));
}
async function buildLocalPrepareManifest(workspacePath) {
  const workspace = normalizeWorkspaceRoot(workspacePath ?? process.cwd());
  const listing = listWorkspaceFiles(workspace);
  return {
    source: "local",
    workspace,
    files: listing.files.map((file2) => ({
      path: file2.relativePath,
      size: file2.size
    })),
    snapshot: {
      filesAnalyzed: listing.files.length,
      filesExcluded: listing.stats.filesExcluded,
      bytesAnalyzed: listing.totalBytes,
      truncated: listing.truncated,
      credentialsSkipped: listing.stats.credentialsSkipped
    },
    totalBytes: listing.totalBytes,
    truncated: listing.truncated,
    redaction: "credentials_excluded_at_walk_time",
    note: "Manifest only. Remote analysis requires explicit user action."
  };
}

// lib/local-analysis/local-tool-handlers.ts
var LOCAL_TOOL_NAMES = [
  "sequrai_local_status",
  "sequrai_local_audit",
  "audit_local_project",
  "sequrai_local_review",
  "sequrai_local_findings",
  "sequrai_local_prepare"
];
var LOCAL_AUDIT_TOOL_NAMES = ["sequrai_local_audit", "audit_local_project"];
function isLocalToolName(name) {
  return LOCAL_TOOL_NAMES.includes(name);
}
function isLocalAuditToolName(name) {
  return LOCAL_AUDIT_TOOL_NAMES.includes(name);
}
function resolveLocalWorkspacePath(args) {
  const authorizedRoot = process.env.SEQURAI_WORKSPACE_ROOT ?? process.cwd();
  return resolveAuthorizedWorkspacePath(authorizedRoot, args.workspacePath);
}
async function executeLocalTool(name, args = {}) {
  let workspacePath;
  try {
    workspacePath = resolveLocalWorkspacePath(args);
  } catch (error51) {
    if (error51 instanceof WorkspaceBoundaryError) {
      throw error51;
    }
    throw error51;
  }
  if (isLocalAuditToolName(name)) {
    return runLocalProductionVerdict({
      workspacePath,
      scope: resolveScopeFromArgs(args),
      gitDiffOnly: args.gitDiffOnly
    });
  }
  switch (name) {
    case "sequrai_local_status":
      return buildLocalWorkspaceStatus(workspacePath);
    case "sequrai_local_review":
      return buildLocalReview({ workspacePath, gitDiffOnly: args.gitDiffOnly });
    case "sequrai_local_findings":
      return buildLocalFindings(workspacePath);
    case "sequrai_local_prepare":
      return buildLocalPrepareManifest(workspacePath);
    default:
      throw new Error(`unknown_local_tool:${name}`);
  }
}
export {
  DEFAULT_IGNORED_DIRS,
  LOCAL_SCAN_LIMITS,
  LOCAL_TOOL_NAMES,
  WorkspaceBoundaryError,
  executeLocalTool,
  isBinaryBuffer,
  isIgnoredRelativePath,
  isLocalToolName,
  listWorkspaceFiles,
  normalizeWorkspaceRoot,
  readWorkspaceTextFile,
  resolveAuthorizedWorkspacePath,
  resolveSafePath,
  runLocalProductionVerdict
};
