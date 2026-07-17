import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function readRootFile(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

/**
 * Full Brightcone "Deploy Frontend" → FlowDesk CI mapping.
 * @see docs/SECURITY_CI.md
 */
describe('CI workflow (Brightcone Deploy Frontend parity)', () => {
  const ci = readRootFile('.github/workflows/ci.yml')
  const guide = readRootFile('docs/SECURITY_CI.md')
  const pkg = JSON.parse(readRootFile('package.json')) as { scripts: Record<string, string> }

  describe('workflow triggers and concurrency (Brightcone header)', () => {
    it('supports push, pull_request, and workflow_dispatch', () => {
      expect(ci).toMatch(/push:/)
      expect(ci).toMatch(/pull_request:/)
      expect(ci).toMatch(/workflow_dispatch:/)
    })

    it('uses concurrency group with cancel-in-progress', () => {
      expect(ci).toMatch(/concurrency:/)
      expect(ci).toMatch(/cancel-in-progress: true/)
    })

    it('does not use Brightcone AWS env (S3_BUCKET, CloudFront, id-token)', () => {
      expect(ci).not.toMatch(/S3_BUCKET/)
      expect(ci).not.toMatch(/CLOUDFRONT_DISTRIBUTION_ID/)
      expect(ci).not.toMatch(/id-token: write/)
      expect(ci).not.toMatch(/brightcone-frontend/)
    })
  })

  describe('check-scope job', () => {
    it('exists with should_deploy output', () => {
      expect(ci).toMatch(/check-scope:/)
      expect(ci).toMatch(/name: Check deployment scope/)
      expect(ci).toMatch(/should_deploy: \$\{\{ steps\.scope\.outputs\.should_deploy \}\}/)
      expect(ci).toMatch(/Decide whether full frontend deployment should run/)
    })

    it('documents check-scope in SECURITY_CI.md', () => {
      expect(guide).toMatch(/check-scope/)
    })
  })

  describe('security-scan job', () => {
    it('is named Security Scan (npm audit + Snyk + Gitleaks + TruffleHog)', () => {
      expect(ci).toMatch(/name: Security Scan \(npm audit \+ Snyk \+ Gitleaks \+ TruffleHog\)/)
    })

    it('needs check-scope and gates on should_deploy', () => {
      expect(ci).toMatch(/needs: \[check-scope\]/)
      expect(ci).toMatch(/needs\.check-scope\.outputs\.should_deploy == 'true'/)
    })

    it('runs npm audit at critical severity with continue-on-error before the gate', () => {
      expect(ci).toMatch(/id: npm_audit/)
      expect(ci).toMatch(/npm run audit:critical/)
      expect(ci).toMatch(/continue-on-error: true/)
    })

    it('runs optional Snyk dependency + SAST at critical threshold', () => {
      expect(ci).toMatch(/snyk_token_check/)
      expect(ci).toMatch(/snyk@1\.1304\.1/)
      expect(ci).toMatch(/snyk test --severity-threshold=critical/)
      expect(ci).toMatch(/snyk code test --severity-threshold=critical/)
      expect(ci).toMatch(/Snyk scan diagnostics/)
    })

    it('runs TruffleHog v3.82.6 for verified secrets in git history', () => {
      expect(ci).toMatch(/Scan for hardcoded secrets \(trufflehog\)/)
      expect(ci).toMatch(/trufflesecurity\/trufflehog@v3\.82\.6/)
      expect(ci).toMatch(/only-verified/)
      expect(ci).toMatch(/HEAD~1/)
    })

    it('runs Gitleaks v8.18.4 on commit history', () => {
      expect(ci).toMatch(/Scan for hardcoded secrets \(gitleaks\)/)
      expect(ci).toMatch(/GITLEAKS_VERSION="8\.18\.4"/)
      expect(ci).toMatch(/gitleaks detect/)
    })

    it('uploads frontend-security-reports artifact and fails the gate on issues', () => {
      expect(ci).toMatch(/frontend-security-reports/)
      expect(ci).toMatch(/Fail if any security scan found issues/)
    })

    it('uses fetch-depth 0 so secret scanners see full history', () => {
      expect(ci).toMatch(/fetch-depth:\s*0/)
    })
  })

  describe('FlowDesk VAPT vitest (extra steps in security-scan)', () => {
    it('runs verify:deps, verify:third-party, and test:security', () => {
      expect(ci).toMatch(/npm run verify:deps/)
      expect(ci).toMatch(/npm run verify:third-party/)
      expect(ci).toMatch(/npm run test:security/)
    })
  })

  describe('run-tests job (Brightcone run-tests parity)', () => {
    it('is named Run Frontend Tests and runs parallel with security-scan via check-scope', () => {
      expect(ci).toMatch(/run-tests:/)
      expect(ci).toMatch(/name: Run Frontend Tests/)
      const runTestsBlock = ci.slice(ci.indexOf('run-tests:'), ci.indexOf('build:'))
      expect(runTestsBlock).toMatch(/needs: \[check-scope\]/)
      expect(runTestsBlock).not.toMatch(/needs: \[security-scan\]/)
    })

    it('uses Vitest test:ci instead of Jest --ci --runInBand', () => {
      expect(ci).toMatch(/name: Run tests/)
      expect(ci).toMatch(/npm run lint/)
      expect(ci).toMatch(/npm run test:ci/)
      expect(ci).not.toMatch(/runInBand/)
    })

    it('uploads frontend-coverage-report including tests/ summary', () => {
      expect(ci).toMatch(/frontend-coverage-report/)
      expect(ci).toMatch(/tests\/coverage-summary\.json/)
      expect(ci).toMatch(/tests\/TEST_REPORT\.md/)
    })
  })

  describe('build job (replaces Brightcone deploy-staging compile step)', () => {
    it('needs check-scope, security-scan, and run-tests like deploy-staging', () => {
      const buildBlock = ci.slice(ci.indexOf('build:'), ci.indexOf('ci-success:'))
      expect(buildBlock).toMatch(/needs: \[check-scope, security-scan, run-tests\]/)
    })

    it('validates dist/index.html after build with FlowDesk OAuth secrets', () => {
      expect(ci).toMatch(/Install dependencies and build/)
      expect(ci).toMatch(/dist\/index\.html/)
      expect(ci).toMatch(/VITE_GOOGLE_CLIENT_ID/)
      expect(ci).toMatch(/VITE_MICROSOFT_CLIENT_ID/)
    })
  })

  describe('deploy-staging (Brightcone only — must NOT exist in FlowDesk CI)', () => {
    it('does not deploy to Brightcone S3, CloudFront, or AWS OIDC', () => {
      expect(ci).not.toMatch(/deploy-staging/)
      expect(ci).not.toMatch(/configure-aws-credentials/)
      expect(ci).not.toMatch(/aws s3 sync/)
      expect(ci).not.toMatch(/cloudfront create-invalidation/)
      expect(ci).not.toMatch(/VITE_HELPDESK/)
      expect(ci).not.toMatch(/VITE_BACKEND_URL/)
      expect(ci).not.toMatch(/brightcone-production-github-deploy/)
    })

    it('documents deploy-staging in SECURITY_CI.md as Brightcone-only', () => {
      expect(guide).toMatch(/deploy-staging/)
      expect(guide).toMatch(/S3/)
      expect(guide).toMatch(/CloudFront/)
    })
  })

  describe('local scripts, shell gate, and docs cover every scanner', () => {
    it('exposes audit and security scan npm scripts', () => {
      expect(pkg.scripts['audit:critical']).toBe('npm audit --audit-level=critical')
      expect(pkg.scripts['security:local']).toContain('audit:critical')
      expect(pkg.scripts['security:scan']).toBe('bash scripts/security-scan.sh')
    })

    it('documents all scanners in SECURITY_CI.md and SNYK_TOKEN in SECRETS.md', () => {
      for (const term of [
        'npm audit',
        'Snyk',
        'TruffleHog',
        'Gitleaks',
        'check-scope',
        'run-tests',
        'build',
      ]) {
        expect(guide).toMatch(new RegExp(term))
      }
      expect(readRootFile('.github/SECRETS.md')).toMatch(/SNYK_TOKEN/)
    })

    it('security-scan.sh mirrors CI security-scan steps', () => {
      const script = readRootFile('scripts/security-scan.sh')
      expect(script).toMatch(/audit:critical/)
      expect(script).toMatch(/verify:deps/)
      expect(script).toMatch(/verify:third-party/)
      expect(script).toMatch(/test:security/)
      expect(script).toMatch(/snyk@1\.1304\.1/)
      expect(script).toMatch(/gitleaks/)
      expect(script).toMatch(/trufflehog/)
    })
  })
})
