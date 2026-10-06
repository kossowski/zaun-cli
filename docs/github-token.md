# GitHub token and signing

## Fine-grained token

Your agents need to clone, push and open pull requests. Don't give the machine your SSH key or a
classic token: both can do anything your account can, on every repository. A
**fine-grained personal access token** can be limited to a few repositories and a few
permissions, and it always expires.

### Create the token

1. On github.com: your profile picture → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   (Direct link: <https://github.com/settings/personal-access-tokens/new>.)
2. **Token name**: something you'll recognise, e.g. `zaun-vm agents`.
   **Description** (optional): which machine it's for.
3. **Resource owner**: you, or the organization that owns the repositories. (An organization may
   require approval: the token then stays _pending_ and can only read public data until an admin
   approves it. Some organizations block fine-grained tokens entirely; they won't appear here.)
4. **Expiration**: 30 or 90 days is a good default. Shorter is safer; you'll
   [rotate](#rotate-or-revoke) it anyway.
5. **Repository access**: **Only select repositories**, then pick the repositories the agents
   should work on. Avoid _All repositories_.
6. **Permissions** → **Repository permissions**: add these and set the access level:

   | Permission    | Access         | Why                                                           |
   | ------------- | -------------- | ------------------------------------------------------------- |
   | Contents      | Read and write | clone, pull, push branches                                    |
   | Pull requests | Read and write | `gh pr create`, `gh pr view`, comments                        |
   | Metadata      | Read-only      | required, added automatically                                 |
   | Issues        | Read and write | _optional_: let agents read and comment on issues             |
   | Actions       | Read-only      | _optional_: `gh run view` / `gh run watch` to read CI results |
   | Workflows     | Read and write | _only if_ agents must change files in `.github/workflows/`    |

   Leave everything else (Administration, Secrets, Account permissions, …) at _No access_.

7. **Generate token**, and copy it now (it's shown only once).

### Log in with it

In the VM:

```sh
read -rs GH_PAT                                    # paste the token, press Enter (nothing is shown)
printf '%s' "$GH_PAT" | gh auth login --with-token
unset GH_PAT
gh auth setup-git                                  # git uses gh's token for https://github.com
```

`gh auth setup-git` makes `git clone/push https://github.com/…` use the same token, so clone your
repositories with HTTPS URLs. gh stores the token in `~/.config/gh/hosts.yml` (on a headless
machine without a keyring, in plain text, readable by your user, which is to say by the agents).
That's the trade-off, and why the token is narrow and short-lived.

(Alternative: export `GH_TOKEN` in your shell. gh picks it up, but it's then in the
environment of every process.)

### Check it

```sh
gh auth status                       # "✓ Logged in to github.com account <you> (…)"
gh repo view REPLACE_ME/some-repo    # a repository you selected
git ls-remote https://github.com/REPLACE_ME/some-repo.git
zaun doctor                          # "✓ gh logged in"
```

A `403` / "Resource not accessible by personal access token" means the repository isn't selected
or a permission is missing: edit the token on GitHub, no new login needed.

### Rotate or revoke

GitHub emails you before the token expires. Then: **Settings → Developer settings →
Fine-grained tokens** → the token → **Regenerate token** (pick a new expiration), and in the VM
run the [login](#log-in-with-it) again. If the machine may be compromised, **Delete** the token
there instead: it stops working immediately.

## Optional: SSH key and commit signing

You don't need SSH for GitHub with the token above. If you want signed commits ("Verified" on
GitHub), use an SSH key that exists only in this VM:

```sh
ssh-keygen -t ed25519 -C "zaun-vm" -f ~/.ssh/id_ed25519
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
cat ~/.ssh/id_ed25519.pub
```

Add the public key on GitHub: **Settings → SSH and GPG keys → New SSH key**, **Key type:
Signing Key**. Keep in mind that the agents can sign with this key too. Signing proves "made on
this VM", not "reviewed by me". Never copy your laptop's keys into the VM.
