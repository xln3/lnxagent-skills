# 通过云服务器安全中转访问内网 SSH 设备

> 本文是脱敏模板。文中的 `CLOUD_PUBLIC_HOST`、`TARGET_LAN_HOST`、`TARGET_LAN_SUBNET`、`CLOUD_SSH_PORT`、`TARGET_SSH_PORT`、`TUNNEL_PORT`、`ADMIN_USER`、`RELAY_USER`、`JUMP_USER` 和 `TARGET_USER` 都是占位符，执行任何命令前必须替换成实际值。不要把占位符原样复制到终端。

## 先看这里：这套方案到底做了什么

目标设备在公司或家庭内网中，公网无法直接访问它。目标设备主动向腾讯云服务器建立一条 SSH 反向隧道，外部使用者先登录腾讯云，再通过这条隧道访问目标设备。

```text
目标设备 -- SSH 使用 RELAY_USER --> 云服务器 CLOUD_PUBLIC_HOST
                                      |
                                      | 仅在云服务器本机开放 127.0.0.1:TUNNEL_PORT
                                      v
                                目标设备 SSH:TARGET_SSH_PORT

外部电脑 -- SSH 使用 JUMP_USER --> 云服务器:CLOUD_SSH_PORT -- ProxyJump --> 127.0.0.1:TUNNEL_PORT
管理员   -- SSH 使用 ADMIN_USER  --> 云服务器管理 shell
```

三个账号各司其职：

- `RELAY_USER`：只给目标设备使用。它只能建立 `-R` 反向转发，不能登录云服务器 shell。
- `JUMP_USER`：只给外部使用者使用。它只能通过 `ProxyJump` 访问云服务器的 `127.0.0.1:TUNNEL_PORT`，不能登录云服务器 shell，也不能访问其他云服务器端口。
- `ADMIN_USER`：只给管理员使用。不要把它提供给外部使用者。

外部使用者通常需要两把不同的密钥：

- `id_ed25519_target_jump`：登录云服务器的 `JUMP_USER` 账号。
- `id_ed25519_target_user`：登录目标设备的 `TARGET_USER` 账号。

两把私钥都留在外部使用者自己的电脑上；云服务器和目标设备分别只保存对应的 `.pub` 公钥。配置完成后，外部使用者只需执行：

```bash
ssh target-via-cloud
```

不需要再输入目标设备的 SSH 密码（私钥如果设置了 passphrase，可能仍需输入私钥口令；可用 `ssh-agent` 缓存）。

## 当前示例参数

所有参数都集中在这里。更换跳板机或目标设备时，先改这张表，再按文档替换命令中的值。

| 参数 | 当前示例值 | 说明 |
|---|---|---|
| 云服务器公网地址 | `CLOUD_PUBLIC_HOST` | 外部使用者和目标设备都连接这里 |
| 云服务器管理员账号 | `ADMIN_USER` | 只给管理员使用 |
| 云服务器反向隧道账号 | `RELAY_USER` | 目标设备连接云服务器使用 |
| 云服务器外部跳板账号 | `JUMP_USER` | 外部使用者连接云服务器使用 |
| 目标设备内网地址 | `TARGET_LAN_HOST` | 仅在目标设备所在网络中使用 |
| 目标设备所在网段 | `TARGET_LAN_SUBNET` | 仅用于说明网络边界，例如 `TARGET_LAN_SUBNET/24` |
| 目标设备 SSH 端口 | `TARGET_SSH_PORT` | 目标设备上的 SSH 服务端口 |
| 目标设备登录账号 | `TARGET_USER` | 建议长期改为每人一个独立账号 |
| 云服务器回环端口 | `TUNNEL_PORT` | 只监听云服务器的 `127.0.0.1` |
| 目标设备中转私钥 | `~/.ssh/id_ed25519_target_relay` | 只在目标设备上保存 |
| 外部使用者跳板私钥 | `~/.ssh/id_ed25519_target_jump` | 每位外部使用者自己保存 |
| 外部使用者目标私钥 | `~/.ssh/id_ed25519_target_user` | 每位外部使用者自己保存 |

文中标记含义：`[云服务器]`、`[目标设备]`、`[外部电脑]`、`[管理员电脑]`。

## 管理员给一个外部使用者开通登录：最简步骤

以下步骤假定 `RELAY_USER` 反向隧道和 `JUMP_USER` 账号已经配置完成。

### 1. 外部使用者生成两把密钥

在外部使用者自己的电脑执行，每条命令单独执行：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_target_jump -C "姓名或设备名-jump"
```

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_target_user -C "姓名或设备名-target"
```

外部使用者把下面两个公钥文件交给管理员，私钥不能发送：

```text
~/.ssh/id_ed25519_target_jump.pub
~/.ssh/id_ed25519_target_user.pub
```

### 2. 管理员把跳板公钥加入云服务器

在云服务器上编辑：

```bash
sudoedit /home/JUMP_USER/.ssh/authorized_keys
```

为该使用者添加一整行。把 `AAAA...` 替换成真实公钥：

```text
no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc,permitopen="127.0.0.1:TUNNEL_PORT" ssh-ed25519 AAAA... person-jump
```

检查权限：

```bash
sudo chown JUMP_USER:JUMP_USER /home/JUMP_USER/.ssh/authorized_keys
```

```bash
sudo chmod 600 /home/JUMP_USER/.ssh/authorized_keys
```

### 3. 管理员把目标设备公钥加入目标账号

在目标设备上编辑：

```bash
sudo -u TARGET_USER nano /home/TARGET_USER/.ssh/authorized_keys
```

把 `id_ed25519_target_user.pub` 的内容作为一整行追加进去，然后执行：

```bash
sudo chown TARGET_USER:TARGET_USER /home/TARGET_USER/.ssh/authorized_keys
```

```bash
sudo chmod 600 /home/TARGET_USER/.ssh/authorized_keys
```

如果当前终端本来就是 `TARGET_USER` 用户，直接执行 `nano ~/.ssh/authorized_keys`，不要使用 `sudoedit`。

### 4. 外部使用者创建 SSH 配置

外部使用者在自己的电脑编辑 `~/.ssh/config`，加入下面内容：

```sshconfig
Host cloud-jump
    HostName CLOUD_PUBLIC_HOST
    Port CLOUD_SSH_PORT
    User JUMP_USER
    IdentityFile ~/.ssh/id_ed25519_target_jump
    IdentitiesOnly yes

Host target-via-cloud
    HostName 127.0.0.1
    Port TUNNEL_PORT
    User TARGET_USER
    ProxyJump cloud-jump
    IdentityFile ~/.ssh/id_ed25519_target_user
    IdentitiesOnly yes
```

### 5. 外部使用者测试

```bash
ssh target-via-cloud
```

如果目标设备仍允许密码登录，也可以让使用者在外部电脑执行一次下面的命令自动安装目标公钥；该命令会要求输入目标设备密码：

```bash
ssh-copy-id -i ~/.ssh/id_ed25519_target_user.pub -o ProxyJump=cloud-jump -p TUNNEL_PORT TARGET_USER@127.0.0.1
```

### 6. 撤销一个外部使用者

管理员从云服务器的 `/home/JUMP_USER/.ssh/authorized_keys` 删除该使用者对应的一整行。

管理员从目标设备的 `/home/TARGET_USER/.ssh/authorized_keys` 删除该使用者对应的一整行。

如果使用的是每人独立的目标设备账号，还应锁定或删除该账号。删除公钥后，已有 SSH 会话不会自动断开；需要时单独终止对应会话。

## 外部使用者：最简使用说明

第一次使用前确认本机存在以下私钥：

```bash
ls -l ~/.ssh/id_ed25519_target_jump ~/.ssh/id_ed25519_target_user
```

确认 `~/.ssh/config` 中有 `cloud-jump` 和 `target-via-cloud` 两个配置后，执行：

```bash
ssh target-via-cloud
```

第一次连接云服务器或目标设备时会看到主机指纹确认提示。只有在管理员确认指纹无误后才输入 `yes`。

退出目标设备：

```bash
exit
```

查看详细连接过程：

```bash
ssh -vvv target-via-cloud
```

如果私钥设置了 passphrase，可以先启动密钥代理并加入两把私钥：

```bash
eval "$(ssh-agent -s)"
```

```bash
ssh-add ~/.ssh/id_ed25519_target_jump
```

```bash
ssh-add ~/.ssh/id_ed25519_target_user
```

Windows OpenSSH 通常也使用 `C:\Users\用户名\.ssh\config` 和同目录下的密钥文件；配置内容保持相同，路径按本机实际位置调整。

## 完整首次部署

### 一、准备并确认参数

先确认以下事项：

- 云服务器公网 SSH 端口可用，当前管理员可以使用 `ADMIN_USER` 登录。
- 目标设备可以主动访问云服务器的 TCP CLOUD_SSH_PORT 端口。
- 目标设备的 SSH 服务确实监听 `TARGET_SSH_PORT`。
- 腾讯云安全组不开放 `TUNNEL_PORT` 公网端口。
- `RELAY_USER` 和 `JUMP_USER` 使用不同的密钥和不同的账号。

### 二、在云服务器创建 RELAY_USER 账号

在云服务器执行：

```bash
sudo adduser --disabled-password --gecos "" --shell /usr/sbin/nologin RELAY_USER
```

```bash
sudo install -d -m 700 -o RELAY_USER -g RELAY_USER /home/RELAY_USER/.ssh
```

```bash
sudo install -m 600 -o RELAY_USER -g RELAY_USER /dev/null /home/RELAY_USER/.ssh/authorized_keys
```

创建或编辑 `/etc/ssh/sshd_config.d/relay.conf`：

```bash
sudoedit /etc/ssh/sshd_config.d/relay.conf
```

将下面内容作为文件内容保存。下面是配置文件内容，不是一条需要整段复制到 shell 的命令：

```text
Match User RELAY_USER
    AllowTcpForwarding remote
    GatewayPorts no
    PermitListen 127.0.0.1:TUNNEL_PORT
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ForceCommand /bin/false
```

检查并重载 SSH：

```bash
sudo sshd -t
```

```bash
sudo systemctl reload ssh
```

如果系统服务名不是 `ssh`，再执行：

```bash
sudo systemctl reload sshd
```

`AllowTcpForwarding remote` 只允许目标设备发起 `-R` 反向转发。`PermitListen` 只允许绑定云服务器的 `127.0.0.1:TUNNEL_PORT`。`ForceCommand /bin/false` 只阻止 shell，不会阻止 `-N` 端口转发。

如果旧版本 OpenSSH 不认识 `PermitListen`，先删除该行，再执行 `sudo sshd -t` 验证；同时保留 `GatewayPorts no` 和显式的 `127.0.0.1` 绑定。

### 三、在目标设备生成 RELAY_USER 密钥

在目标设备执行：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_target_relay -C "target-relay"
```

这条命令生成：

```text
~/.ssh/id_ed25519_target_relay       私钥，只留在目标设备
~/.ssh/id_ed25519_target_relay.pub   公钥，复制到云服务器
```

### 四、把 RELAY_USER 公钥加入云服务器

只复制公钥，不复制私钥。查看目标设备公钥：

```bash
cat ~/.ssh/id_ed25519_target_relay.pub
```

在云服务器编辑：

```bash
sudoedit /home/RELAY_USER/.ssh/authorized_keys
```

把公钥粘贴为一整行，然后执行：

```bash
sudo chown RELAY_USER:RELAY_USER /home/RELAY_USER/.ssh/authorized_keys
```

```bash
sudo chmod 600 /home/RELAY_USER/.ssh/authorized_keys
```

### 五、在目标设备测试反向隧道

如果目标设备的 SSH 服务监听 `127.0.0.1:TARGET_SSH_PORT`，执行：

```bash
ssh -p CLOUD_SSH_PORT -i ~/.ssh/id_ed25519_target_relay -o IdentitiesOnly=yes -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:TUNNEL_PORT:127.0.0.1:TARGET_SSH_PORT RELAY_USER@CLOUD_PUBLIC_HOST
```

如果目标设备只监听 `TARGET_LAN_HOST:TARGET_SSH_PORT`，把最后的转发目标改成：

```bash
-R 127.0.0.1:TUNNEL_PORT:TARGET_LAN_HOST:TARGET_SSH_PORT
```

使用 `-N -T` 时，命令没有新提示并持续占用终端是正常现象。不要按 `Ctrl-C`，否则会关闭隧道。

在云服务器另开一个终端检查：

```bash
ss -lntp | grep TUNNEL_PORT
```

正确结果应显示云服务器正在监听：

```text
127.0.0.1:TUNNEL_PORT
```

### 六、在云服务器创建 JUMP_USER 账号

在云服务器执行：

```bash
sudo adduser --disabled-password --gecos "" --shell /usr/sbin/nologin JUMP_USER
```

```bash
sudo install -d -m 700 -o JUMP_USER -g JUMP_USER /home/JUMP_USER/.ssh
```

```bash
sudo install -m 600 -o JUMP_USER -g JUMP_USER /dev/null /home/JUMP_USER/.ssh/authorized_keys
```

创建或编辑 `/etc/ssh/sshd_config.d/jump.conf`：

```bash
sudoedit /etc/ssh/sshd_config.d/jump.conf
```

将下面内容保存为文件内容：

```text
Match User JUMP_USER
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:TUNNEL_PORT
    PermitTTY no
    X11Forwarding no
    AllowAgentForwarding no
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ForceCommand /bin/false
```

检查并重载：

```bash
sudo sshd -t
```

```bash
sudo systemctl reload ssh
```

`AllowTcpForwarding local` 是给 `ProxyJump` 使用的；`PermitOpen` 把 JUMP_USER 账号限制到唯一目标 `127.0.0.1:TUNNEL_PORT`。不要给 `JUMP_USER` 配置 `AllowTcpForwarding remote`，也不要给外部使用者 `ADMIN_USER` 账号。

### 七、为第一个外部使用者配置两把密钥

让外部使用者在自己的电脑执行：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_target_jump -C "person-jump"
```

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_target_user -C "person-target"
```

管理员把 `id_ed25519_target_jump.pub` 加到云服务器：

```bash
sudoedit /home/JUMP_USER/.ssh/authorized_keys
```

使用带限制选项的一整行：

```text
no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc,permitopen="127.0.0.1:TUNNEL_PORT" ssh-ed25519 AAAA... person-jump
```

不要加入 `no-port-forwarding`，否则 `ProxyJump` 会被禁止。管理员修正权限：

```bash
sudo chown JUMP_USER:JUMP_USER /home/JUMP_USER/.ssh/authorized_keys
```

```bash
sudo chmod 600 /home/JUMP_USER/.ssh/authorized_keys
```

管理员把 `id_ed25519_target_user.pub` 加到目标设备：

```bash
sudo -u TARGET_USER nano /home/TARGET_USER/.ssh/authorized_keys
```

如果当前就是 `TARGET_USER` 用户，使用：

```bash
nano ~/.ssh/authorized_keys
```

修正目标设备权限：

```bash
sudo chown TARGET_USER:TARGET_USER /home/TARGET_USER/.ssh/authorized_keys
```

```bash
sudo chmod 600 /home/TARGET_USER/.ssh/authorized_keys
```

### 八、外部使用者配置并测试

外部使用者在自己的 `~/.ssh/config` 写入：

```sshconfig
Host cloud-jump
    HostName CLOUD_PUBLIC_HOST
    Port CLOUD_SSH_PORT
    User JUMP_USER
    IdentityFile ~/.ssh/id_ed25519_target_jump
    IdentitiesOnly yes

Host target-via-cloud
    HostName 127.0.0.1
    Port TUNNEL_PORT
    User TARGET_USER
    ProxyJump cloud-jump
    IdentityFile ~/.ssh/id_ed25519_target_user
    IdentitiesOnly yes
```

执行：

```bash
ssh target-via-cloud
```

## 持久化 RELAY_USER 隧道

首次手工测试成功后，建议使用目标设备上的 systemd 用户服务自动重连。以下内容分为“编辑文件”和“执行命令”，不要把多行配置文件内容当成一条 shell 命令执行。

在目标设备执行：

```bash
mkdir -p ~/.config/systemd/user
```

编辑服务文件：

```bash
nano ~/.config/systemd/user/tencent-relay.service
```

写入以下文件内容：

```ini
[Unit]
Description=Reverse SSH tunnel to Tencent Cloud
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/ssh -p CLOUD_SSH_PORT -i %h/.ssh/id_ed25519_target_relay -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:TUNNEL_PORT:127.0.0.1:TARGET_SSH_PORT RELAY_USER@CLOUD_PUBLIC_HOST
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

如果目标设备 SSH 只监听内网地址，把 `ExecStart` 中的 `127.0.0.1:TARGET_SSH_PORT` 改成 `TARGET_LAN_HOST:TARGET_SSH_PORT`。

确认云服务器主机指纹已经记录后，执行：

```bash
systemctl --user daemon-reload
```

```bash
systemctl --user enable --now tencent-relay.service
```

```bash
systemctl --user status tencent-relay.service
```

如果希望用户未登录时也自动运行，使用目标设备管理员账号执行：

```bash
sudo loginctl enable-linger TARGET_USER
```

如果实际运行隧道的用户不是 `TARGET_USER`，把服务文件路径、`%h` 对应的用户和 `enable-linger` 参数替换成实际用户。

## 为什么 RELAY_USER 和 JUMP_USER 要分开

`RELAY_USER` 和 `JUMP_USER` 的方向相反，权限也不同：

- `RELAY_USER` 允许目标设备发起 `-R`，让云服务器拥有一个回环监听端口。
- `JUMP_USER` 允许外部电脑使用 `ProxyJump`，让云服务器访问自己的回环端口。
- `RELAY_USER` 不应该拥有 `JUMP_USER` 的 `-W` 能力，`JUMP_USER` 也不应该拥有 `RELAY_USER` 的远程监听能力。
- 两个账号分开后，可以分别撤销、审计和轮换密钥。

如果把 `ADMIN_USER` 提供给外部使用者，他们通常会获得云服务器 shell 和其他管理权限，违反最小权限原则。

## 为什么两把密钥也要分开

技术上可以把同一把公钥同时放进云服务器 `JUMP_USER` 和目标设备账号，但不推荐：

- 跳板私钥泄露会同时影响云服务器和目标设备。
- 目标设备私钥泄露会同时影响两个入口。
- 撤销或轮换某一侧权限时必须同时修改两台设备。
- 同一个指纹同时出现在两台设备，审计和责任追踪更困难。

分开密钥不能替代终端安全；如果外部电脑整体被攻破，两把私钥仍可能同时泄露。但单把密钥泄露时，分开密钥可以限制影响范围。

## 常见问题和排查

### 命令看起来卡住了

`ssh -N -T` 成功后不会打开 shell，也不会继续输出，保持占用终端是正常的。另开终端在云服务器执行：

```bash
ss -lntp | grep TUNNEL_PORT
```

看到 `127.0.0.1:TUNNEL_PORT` 说明隧道已建立。

### `Permission denied (publickey)`

确认使用的是正确的私钥，并检查三处公钥：

```bash
ls -l ~/.ssh/id_ed25519_target_jump ~/.ssh/id_ed25519_target_user
```

云服务器：

```bash
sudo ls -l /home/JUMP_USER/.ssh/authorized_keys
```

目标设备：

```bash
ls -l ~/.ssh/authorized_keys
```

### `administratively prohibited`

检查云服务器的限制配置：

```bash
sudo sshd -T -C user=JUMP_USER,addr=127.0.0.1,host=localhost | grep -E 'allowtcpforwarding|permitopen|permitlisten|gatewayports'
```

```bash
sudo sshd -T -C user=RELAY_USER,addr=127.0.0.1,host=localhost | grep -E 'allowtcpforwarding|permitopen|permitlisten|gatewayports'
```

修改后检查并重载：

```bash
sudo sshd -t
```

```bash
sudo systemctl reload ssh
```

### `Connection refused`

确认目标设备 SSH 服务监听端口：

```bash
ss -lntp | grep TARGET_SSH_PORT
```

如果只监听 `TARGET_LAN_HOST:TARGET_SSH_PORT`，把 `-R` 目标从 `127.0.0.1:TARGET_SSH_PORT` 改成 `TARGET_LAN_HOST:TARGET_SSH_PORT`。

### `sudoedit: editing files in a writable directory is not permitted`

这是 `sudoedit` 的安全保护。当前用户如果本来就是文件目录的所有者，直接编辑即可：

```bash
nano ~/.ssh/authorized_keys
```

不要为了编辑自己的 SSH 文件强行使用 `sudoedit`。

### `usermod: no changes`

通常表示账号已存在，且请求的属性已经符合当前配置。只读检查：

```bash
id RELAY_USER
```

```bash
getent passwd RELAY_USER
```

```bash
sudo passwd -S RELAY_USER
```

```bash
sudo ls -la /home/RELAY_USER/.ssh
```

`RELAY_USER` 的 shell 应为 `/usr/sbin/nologin`，密码状态通常为 `L`。没有 `.ssh` 目录和 `authorized_keys` 通常表示尚未配置该账号的 SSH 登录密钥。

### 主机指纹提示

第一次连接某台机器时看到 `The authenticity of host ... can't be established` 是正常的。应先通过可信渠道确认 ED25519 指纹，再输入 `yes`。不要为了绕过提示使用 `StrictHostKeyChecking=no`。

## 替换跳板机或目标设备时怎么做

### 只更换目标设备

1. 在目标设备生成新的 `id_ed25519_target_relay`。
2. 把新公钥加入云服务器 `/home/RELAY_USER/.ssh/authorized_keys`。
3. 在目标设备重新测试 `-R` 隧道。
4. 让外部使用者继续使用同一个 `target-via-cloud` 配置，除非目标用户、端口或回环端口发生变化。

### 只更换云服务器

1. 更新云服务器公网地址。
2. 更新目标设备的 RELAY_USER 命令或 systemd 服务文件中的地址。
3. 更新外部使用者 `cloud-jump` 的 `HostName`。
4. 重新确认云服务器主机指纹。
5. 检查腾讯云安全组只开放必要的 SSH 入口。

### 同时更换跳板机和目标设备

按“首次部署”从第二步开始重新配置。不要复制旧机器的私钥；为新跳板机和新目标设备分别生成新密钥。

### 更换端口

如果将云服务器回环端口从 `TUNNEL_PORT` 改为其他端口，必须同时修改：

- `/etc/ssh/sshd_config.d/relay.conf` 的 `PermitListen`。
- `/etc/ssh/sshd_config.d/jump.conf` 的 `PermitOpen`。
- 目标设备的 `-R` 参数或 systemd 服务。
- 外部使用者 `target-via-cloud` 的 `Port`。
- 每个 `JUMP_USER` 公钥行中的 `permitopen`。

## 回滚和撤销

停止目标设备上的自动隧道：

```bash
systemctl --user disable --now tencent-relay.service
```

删除服务文件：

```bash
rm ~/.config/systemd/user/tencent-relay.service
```

删除某个外部使用者：

- 从云服务器 `/home/JUMP_USER/.ssh/authorized_keys` 删除对应公钥行。
- 从目标设备账号的 `authorized_keys` 删除对应公钥行。
- 如使用独立目标账号，锁定或删除该账号。

删除整个 RELAY_USER 账号前，先确认没有其他目标设备依赖它：

```bash
sudo rm -f /etc/ssh/sshd_config.d/relay.conf
```

```bash
sudo systemctl reload ssh
```

```bash
sudo userdel -r RELAY_USER
```

## 安全边界

- 云服务器只需对外提供 SSH 管理端口 `CLOUD_SSH_PORT`；不要开放 `TUNNEL_PORT`。
- `TUNNEL_PORT` 必须绑定 `127.0.0.1`，不要使用 `0.0.0.0`。
- 不要把 `ADMIN_USER` 管理账号提供给外部使用者。
- 每位外部使用者使用独立的 `JUMP_USER` 公钥和目标设备公钥。
- 目标设备上最好为每个人创建独立系统账号，避免所有人共享 `TARGET_USER`。
- 确认目标设备公钥登录成功后，再考虑关闭目标设备密码登录。
- 目标设备仍然连接公司网络，部署前应获得公司 IT 对出站 SSH 隧道和远程访问的确认。
- 这条隧道只转发一个 SSH 端口，不提供到 `TARGET_LAN_SUBNET` 的整体路由。

参考：

- [OpenSSH sshd_config 手册](https://man.openbsd.org/sshd_config)
- [CISA 远程访问和网络分段建议](https://www.cisa.gov/resources-tools/resources/enhanced-visibility-and-hardening-guidance-communications-infrastructure)
