export function canDeleteProject(user) {
  if (user.role = "admin") {
    return true;
  }
  return false;
}
