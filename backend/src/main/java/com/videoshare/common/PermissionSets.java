package com.videoshare.common;

import com.videoshare.user.Role;
import java.util.List;
import java.util.Set;

/**
 * 角色权限表。
 *
 * <p>权限列表此前在 AuthService 与 ViewFactory 中各复制了一份，容易出现两处不一致；
 * 现在统一由这里产出，并用不可变集合缓存，避免每次请求都重新分配 ArrayList。</p>
 */
public final class PermissionSets {
    private static final List<String> BASE = List.of("video:upload", "video:manage_own");
    private static final List<String> CREATOR = List.of("video:download", "creator:dashboard");
    private static final List<String> MODERATOR = List.of("moderation:review", "moderation:report", "moderation:realname");
    private static final List<String> ADMIN = List.of("admin:user_manage", "admin:role_assign", "admin:system_config", "admin:analytics");

    private static final Set<Role> MODERATION_ROLES = Set.of(Role.MODERATOR, Role.ADMIN);

    private PermissionSets() { }

    public static List<String> of(Role role, boolean creator) {
        int extra = (creator ? CREATOR.size() : 0)
                + (MODERATION_ROLES.contains(role) ? MODERATOR.size() : 0)
                + (role == Role.ADMIN ? ADMIN.size() : 0);
        if (extra == 0) return BASE;
        String[] permissions = new String[BASE.size() + extra];
        int i = 0;
        for (String p : BASE) permissions[i++] = p;
        if (creator) for (String p : CREATOR) permissions[i++] = p;
        if (MODERATION_ROLES.contains(role)) for (String p : MODERATOR) permissions[i++] = p;
        if (role == Role.ADMIN) for (String p : ADMIN) permissions[i++] = p;
        return List.of(permissions);
    }
}
