import * as fs from 'fs';
import * as path from 'path';
import { REQUIRED_ENV } from './validate-env';

/**
 * Closes the gap identified in the Track 0 whole-branch review: nothing
 * previously checked that a var added to REQUIRED_ENV also exists in the
 * K8s manifest that actually feeds the deployed pod. Without this test, a
 * var can be declared required here, pass locally (where .env supplies it),
 * and still crash-loop the pod on deploy because the ConfigMap/Secret never
 * got the matching entry.
 *
 * This test reads the manifest as plain text (regex/line-scan, no YAML
 * parser dependency) and asserts every REQUIRED_ENV name is actually
 * supplied to the container — either via the ConfigMap or via the
 * ExternalSecret-backed Secret, both of which reach the container through
 * `envFrom` in k8s/services/education-service.yaml.
 */

const MANIFEST_PATH = path.join(
  __dirname,
  '../../../k8s/services/education-service.yaml',
);
const manifestText = fs.readFileSync(MANIFEST_PATH, 'utf8');

// The manifest is a multi-document YAML file (Deployment, Service,
// ConfigMap, ExternalSecret) separated by `---`. Split it apart so the
// ConfigMap's `data:` block can't accidentally match keys from another
// document (e.g. the Deployment's `env`-shaped fields).
const documents = manifestText.split(/^---$/m);

const configMapDoc = documents.find(
  (doc) =>
    /kind:\s*ConfigMap/.test(doc) &&
    doc.includes('name: speakasap-education-config'),
);
if (!configMapDoc) {
  throw new Error(
    'Could not find the speakasap-education-config ConfigMap document in ' +
      'k8s/services/education-service.yaml — has the manifest been restructured?',
  );
}

const externalSecretDoc = documents.find(
  (doc) =>
    /kind:\s*ExternalSecret/.test(doc) &&
    doc.includes('name: speakasap-education-secret'),
);
if (!externalSecretDoc) {
  throw new Error(
    'Could not find the speakasap-education-secret ExternalSecret document in ' +
      'k8s/services/education-service.yaml — has the manifest been restructured?',
  );
}

// ConfigMap keys: two-space-indented `KEY: "value"` lines under `data:`.
const configMapDataBlock = configMapDoc.slice(configMapDoc.indexOf('\ndata:'));
const configMapKeys = new Set(
  [...configMapDataBlock.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]),
);

// Secret keys: the ExternalSecret's `data[].secretKey` entries. ESO writes
// these into the `speakasap-education-secret` K8s Secret, which the
// Deployment consumes via `envFrom: - secretRef: name: speakasap-education-secret`
// — so each `secretKey` here becomes an env var name in the container,
// exactly like a ConfigMap key does.
const secretKeys = new Set(
  [...externalSecretDoc.matchAll(/secretKey:\s*(\S+)/g)].map((m) => m[1]),
);

// REQUIRED_ENV vars that are intentionally NOT in the ConfigMap because they
// are secrets sourced from the speakasap-education-secret ExternalSecret
// (Vault-backed) instead. Keep this list explicit and reviewed by hand —
// do not replace the ConfigMap-membership check below with "anything in
// secretKeys passes", or a typo'd/missing ConfigMap entry would silently
// pass by looking like a Secret-sourced var.
const SECRET_SOURCED_REQUIRED_ENV = new Set([
  'DATABASE_URL', // secret/prod/speakasap/education via ExternalSecret
  'EDUCATION_TO_USER_SERVICE_TOKEN',
  'EDUCATION_TO_NOTIFICATION_SERVICE_TOKEN',
  'EDUCATION_TO_CONTENT_SERVICE_TOKEN',
]);

describe('REQUIRED_ENV is fully covered by the K8s manifest', () => {
  it('provides every REQUIRED_ENV var via the ConfigMap, or an explicitly allow-listed Secret key', () => {
    const missing = REQUIRED_ENV.filter((key) => {
      if (SECRET_SOURCED_REQUIRED_ENV.has(key)) {
        return !secretKeys.has(key);
      }
      return !configMapKeys.has(key);
    });

    expect(missing).toEqual([]);
  });

  it('keeps the Secret-sourced allow-list honest: those vars must not also be in the ConfigMap', () => {
    const wronglyInConfigMap = [...SECRET_SOURCED_REQUIRED_ENV].filter((key) =>
      configMapKeys.has(key),
    );
    expect(wronglyInConfigMap).toEqual([]);
  });
});
