type LooseProfile = Record<string, any> | null
type LooseMembership = Record<string, any> | null

const ADMIN_ROLE_VALUES = new Set(["admin", "superadmin", "owner"])

function hasAdminRole(input: unknown): boolean {
  if (Array.isArray(input)) return input.some(hasAdminRole)
  if (typeof input !== "string") return false

  return input
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .some((value) => ADMIN_ROLE_VALUES.has(value))
}

function hasAdminFlag(input: unknown): boolean {
  if (typeof input === "boolean") return input
  if (typeof input === "number") return input === 1
  if (typeof input !== "string") return false
  return ["1", "true", "yes"].includes(input.trim().toLowerCase())
}

function getProfileAdminState(profile: LooseProfile) {
  if (!profile) return false

  return (
    hasAdminRole(profile.role) ||
    hasAdminRole(profile.roles) ||
    hasAdminFlag(profile.is_admin) ||
    hasAdminFlag(profile.isAdmin) ||
    hasAdminFlag(profile.admin)
  )
}

export const useAdmin = () => {
  const { $supabase } = useNuxtApp() as any
  const config = useRuntimeConfig()
  const auth = useAuth()

  const adminProfile = useState<LooseProfile>("admin_profile", () => null)
  const adminProfileLoaded = useState<boolean>("admin_profile_loaded", () => false)
  const adminMembership = useState<LooseMembership>("admin_membership", () => null)
  const adminMembershipLoaded = useState<boolean>("admin_membership_loaded", () => false)

  const adminEmails = computed(() =>
    String(config.public.ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )

  const sessionIsAdmin = computed(() => {
    const user = auth.session.value?.user
    const email = String(user?.email || "").trim().toLowerCase()

    return (
      hasAdminRole(user?.app_metadata?.role) ||
      hasAdminRole(user?.app_metadata?.roles) ||
      hasAdminRole(user?.user_metadata?.role) ||
      hasAdminRole(user?.user_metadata?.roles) ||
      hasAdminFlag(user?.app_metadata?.is_admin) ||
      hasAdminFlag(user?.user_metadata?.is_admin) ||
      adminEmails.value.includes(email)
    )
  })

  const profileIsAdmin = computed(() => getProfileAdminState(adminProfile.value))
  const membershipIsAdmin = computed(() => {
    const membership = adminMembership.value
    if (!membership) return false
    if (String(membership.status || "").toLowerCase() !== "active") return false

    const level = membership.level || null
    return (
      level?.can_access_admin === true ||
      hasAdminRole(level?.code) ||
      hasAdminRole(level?.name)
    )
  })

  const isAdmin = computed(() => sessionIsAdmin.value || membershipIsAdmin.value || profileIsAdmin.value)

  async function loadAdminMembership(force = false) {
    if (!force && adminMembershipLoaded.value) return adminMembership.value

    const uid = auth.session.value?.user?.id
    if (!uid) {
      adminMembership.value = null
      adminMembershipLoaded.value = true
      return null
    }

    try {
      const { data, error } = await $supabase
        .from("customer_level_memberships")
        .select("status, level:customer_levels(code,name,can_access_admin)")
        .eq("user_id", uid)
        .eq("status", "active")
        .maybeSingle()

      if (error) throw error

      adminMembership.value = data || null
      adminMembershipLoaded.value = true
      return data || null
    } catch {
      adminMembership.value = null
      adminMembershipLoaded.value = true
      return null
    }
  }

  async function loadAdminProfile(force = false) {
    if (!force && adminProfileLoaded.value) return adminProfile.value

    const uid = auth.session.value?.user?.id
    if (!uid) {
      adminProfile.value = null
      adminProfileLoaded.value = true
      return null
    }

    try {
      const q1 = await $supabase.from("profiles").select("*").eq("id", uid).maybeSingle()
      let profile = q1?.data || null

      if (!profile && !q1?.error) {
        const q2 = await $supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle()
        profile = q2?.data || null
      }

      adminProfile.value = profile
      adminProfileLoaded.value = true
      return profile
    } catch {
      adminProfile.value = null
      adminProfileLoaded.value = true
      return null
    }
  }

  async function refreshAdminState(force = false) {
    await auth.init()
    if (force) await auth.getSession()

    if (!auth.session.value) {
      adminProfile.value = null
      adminProfileLoaded.value = true
      adminMembership.value = null
      adminMembershipLoaded.value = true
      return false
    }

    if (!sessionIsAdmin.value) {
      await loadAdminMembership(force)
      await loadAdminProfile(force)
    }

    return isAdmin.value
  }

  return {
    adminProfile,
    adminMembership,
    isAdmin,
    refreshAdminState,
  }
}
