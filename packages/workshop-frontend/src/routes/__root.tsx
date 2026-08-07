import { useState, useEffect } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useRpcStub, useConnectionLost } from '../RpcContext'
import { markConnectionRestored } from '../main'
import { useAuth, CF_ACCESS_MODE } from '../useAuth'
import { AuthProvider } from '../AuthContext'
import { FeatureFlagsProvider } from '../FeatureFlagsContext'
import Header from '../components/Header'
import AppShell from '../components/AppShell/AppShell'
import LoginPage from '../LoginPage'
import OnboardingWizard from '../OnboardingWizard'
import AccountSelectionModal from '../components/billing/AccountSelectionModal'
import { NucleoIconProvider, TooltipProvider, Toaster } from '@matser/ui'
export const Route = createRootRoute({
  component: RootComponent,
})

function ConnectionLostBanner() {
  return (
    <div className="sticky top-0 z-[100] bg-status-warning-muted border-b border-status-warning/30 px-4 py-2 text-center text-sm text-status-warning">
      Connection lost — reconnecting…
    </div>
  )
}

function RootComponent() {
  const rpcStub = useRpcStub()
  const connectionLost = useConnectionLost()
  const { isAuthenticated, authenticatedApi, isLoading, error, logout, login } = useAuth(rpcStub)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // When authenticatedApi becomes available, the connection is proven alive.
  useEffect(() => {
    if (authenticatedApi) markConnectionRestored()
  }, [authenticatedApi])

  // Routes that don't require auth (public routes)
  const isSignup = pathname === '/signup'
  const isBlueprint = pathname.startsWith('/blueprint/')
  const isAuthorityPrototype = import.meta.env.DEV && pathname === '/authority-prototype'

  // A standalone (no app shell) render is used only for signed-out visitors of public routes.
  // Signed-in users get the full app chrome so public pages (esp. the blueprint detail) feel
  // native — sidebar and all — instead of floating on a bare page.
  const standalone = isSignup || (isBlueprint && !isAuthenticated)

  // The workspace editor renders fullscreen (no app chrome). /gadget/ is the legacy URL, kept
  // here so the chrome doesn't flash in during the redirect to /workspace/.
  const isWorkspaceEditor = pathname.startsWith('/workspace/') || pathname.startsWith('/gadget/')

  const handleLoginSuccess = () => {
    const token = localStorage.getItem('authToken')
    if (token) {
      login(token)
    }
  }

  // The throwaway authority prototype is deliberately independent of auth and
  // onboarding so reviewers can open it with the single prototype command.
  if (isAuthorityPrototype) {
    return (
      <NucleoIconProvider>
        <TooltipProvider>
          <Toaster>
            <Outlet />
          </Toaster>
        </TooltipProvider>
      </NucleoIconProvider>
    )
  }

  // Loading state
  if (isLoading && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-background">
        {connectionLost && <ConnectionLostBanner />}
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">{connectionLost ? 'Waiting for server…' : 'Loading...'}</p>
      </div>
    )
  }

  // Auth error
  if (error && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-background p-6">
        <p className="text-sm text-destructive">Authentication error: {error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // CF Access mode: show spinner while pipelined auth resolves
  if (!isAuthenticated && CF_ACCESS_MODE && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Authenticating...</p>
      </div>
    )
  }

  // Not authenticated and not a public route — show login
  if (!isAuthenticated && !standalone) {
    // LoginPage uses the UI package's Spinner, which resolves the configured
    // loader icon through NucleoIconProvider.
    return (
      <NucleoIconProvider>
        <LoginPage rpcStub={rpcStub} onLoginSuccess={handleLoginSuccess} />
      </NucleoIconProvider>
    )
  }

  // Signed-out visitors of public routes render without the auth wrapper / app shell.
  if (standalone) {
    const showHeader = !isSignup
    return (
      <NucleoIconProvider>
        <TooltipProvider>
          <Toaster>
            {showHeader && <Header />}
            <Outlet />
          </Toaster>
        </TooltipProvider>
      </NucleoIconProvider>
    )
  }

  // Authenticated — render the full shell (with onboarding gate)
  // authenticatedApi is guaranteed non-null here: isLoading, error, and
  // !isAuthenticated branches all return early above.
  if (!authenticatedApi) return null
  return (
    <AuthProvider authenticatedApi={authenticatedApi} onLogout={logout}>
      <FeatureFlagsProvider>
        <NucleoIconProvider>
          <TooltipProvider>
            <Toaster>
              <AuthenticatedShell
                authenticatedApi={authenticatedApi}
                connectionLost={connectionLost}
                isWorkspaceEditor={isWorkspaceEditor}
              />
            </Toaster>
          </TooltipProvider>
        </NucleoIconProvider>
      </FeatureFlagsProvider>
    </AuthProvider>
  )
}

/**
 * Inner shell that checks onboarding status and either shows the wizard
 * or the normal app chrome. Lives inside AuthProvider so the wizard can
 * use useAuthenticatedApi().
 */
function AuthenticatedShell({
  authenticatedApi,
  connectionLost,
  isWorkspaceEditor,
}: {
  authenticatedApi: RpcStub<AuthenticatedApi>
  connectionLost: boolean
  isWorkspaceEditor: boolean
}) {
  // null = still checking, true = needs onboarding, false = onboarding done
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    authenticatedApi.isOnboardingCompleted().then((completed) => {
      if (!cancelled) setOnboardingNeeded(!completed)
    }).catch((err) => {
      console.error('Failed to check onboarding status:', err)
      // If the check fails, skip onboarding to avoid blocking the user
      if (!cancelled) setOnboardingNeeded(false)
    })
    return () => { cancelled = true }
  }, [authenticatedApi])

  // Still checking onboarding status
  if (onboardingNeeded === null) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Show onboarding wizard
  if (onboardingNeeded) {
    return <OnboardingWizard onComplete={() => setOnboardingNeeded(false)} />
  }

  // Normal app shell. The workspace editor is rendered fullscreen (no chrome); everything else
  // gets the persistent left-rail AppShell.
  const fullscreen = isWorkspaceEditor
  return (
    <>
      {connectionLost && <ConnectionLostBanner />}
      <AccountSelectionModal />
      {fullscreen ? (
        <main>
          <Outlet />
        </main>
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
    </>
  )
}
