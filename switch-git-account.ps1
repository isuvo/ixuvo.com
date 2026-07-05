# switch-git-account.ps1
# Switches GitHub account based on repo ownership:
#   - kage-tech org repos → use shuvo-kage (org member)
#   - Personal repos → use isuvo (personal account)

param(
    [string]$TargetAccount = ""
)

# ============================================================
# Account Configuration
# ============================================================

# Account mapping: which account to use for which context
$ACCOUNT_MAP = @{
    "kage-tech" = "shuvo-kage"   # Org member account for kage-tech repos
    "personal"  = "isuvo"        # Personal account for non-org repos
}

# ============================================================
# STEP 1: Check if directory belongs to any git repo
# ============================================================

Write-Host "`n[STEP 1] Checking if this directory is a git repository..." -ForegroundColor Cyan

# Check if git is available
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Git is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# Check if current directory is a git repo
$gitRoot = git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] This directory is NOT a git repository." -ForegroundColor Red
    Write-Host "        Please navigate to a git repo first, or clone one." -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] This directory IS a git repository." -ForegroundColor Green
Write-Host "    Git root: $gitRoot" -ForegroundColor Gray

# Get remote URL
$remoteUrl = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) {
    Write-Host "[WARNING] No 'origin' remote configured for this repo." -ForegroundColor Yellow
    Write-Host "          This repo may not be linked to any GitHub account." -ForegroundColor Yellow
    $isLinked = $false
} else {
    $isLinked = $true
}

# ============================================================
# STEP 2: Display current repo info
# ============================================================

Write-Host "`n[STEP 2] Current Repository Information" -ForegroundColor Cyan

# Extract owner/repo from remote URL
if ($isLinked) {
    # Handle both HTTPS and SSH URLs
    if ($remoteUrl -match "github\.com[:/](.+?)/(.+?)(?:\.git)?$") {
        $currentOwner = $Matches[1]
        $currentRepo = $Matches[2]
        
        Write-Host "    Remote URL:   $remoteUrl" -ForegroundColor White
        Write-Host "    Repository:    $currentRepo" -ForegroundColor White
        
        # Check if owner is an organization or user account
        $ownerType = gh api "/users/$currentOwner" --jq '.type' 2>$null
        if ($ownerType -eq "Organization") {
            Write-Host "    Owner/Account: $currentOwner (GitHub Organization)" -ForegroundColor Yellow
            Write-Host "    [INFO] This is an org repo - use shuvo-kage account (org member)" -ForegroundColor Cyan
        } elseif ($ownerType -eq "User") {
            Write-Host "    Owner/Account: $currentOwner (GitHub User)" -ForegroundColor Cyan
            if ($currentOwner -eq $ACCOUNT_MAP["kage-tech"]) {
                Write-Host "    [INFO] This is your org member account - can access kage-tech repos" -ForegroundColor Cyan
            } else {
                Write-Host "    [INFO] This is a personal user account" -ForegroundColor Cyan
            }
        } else {
            Write-Host "    Owner/Account: $currentOwner" -ForegroundColor White
        }
        
        # Check current GitHub auth status
        Write-Host "`n    Checking GitHub authentication..." -ForegroundColor Gray
        $ghAuthStatus = gh auth status 2>&1
        $ghUser = ($ghAuthStatus | Select-String "Logged in to github.com account\s+(\S+)").Matches.Groups[1].Value
        
        if ($ghUser) {
            Write-Host "    Logged in as:  $ghUser" -ForegroundColor White
            if ($ghUser -eq $currentOwner) {
                Write-Host "    [OK] Auth matches repo owner." -ForegroundColor Green
            } else {
                Write-Host "    [MISMATCH] Auth account ($ghUser) differs from repo owner ($currentOwner)." -ForegroundColor Yellow
                
                # Show recommended account based on repo type
                if ($ownerType -eq "Organization") {
                    $recommended = $ACCOUNT_MAP["kage-tech"]
                    Write-Host "    [RECOMMENDATION] Use '$recommended' for kage-tech org repos" -ForegroundColor Green
                } else {
                    $recommended = $ACCOUNT_MAP["personal"]
                    Write-Host "    [RECOMMENDATION] Use '$recommended' for personal repos" -ForegroundColor Green
                }
            }
        } else {
            Write-Host "    [WARNING] Not logged into GitHub CLI." -ForegroundColor Yellow
        }
    } else {
        Write-Host "    Remote URL: $remoteUrl" -ForegroundColor White
        Write-Host "    [WARNING] Could not parse owner/repo from URL." -ForegroundColor Yellow
    }
} else {
    Write-Host "    Remote URL: None (no origin remote)" -ForegroundColor Yellow
    Write-Host "    This repo is local-only." -ForegroundColor Yellow
}

# ============================================================
# STEP 3: Ask user to confirm switch
# ============================================================

Write-Host "`n[STEP 3] Account Switch" -ForegroundColor Cyan

if (-not $isLinked) {
    Write-Host "This repo is not linked to any GitHub account." -ForegroundColor Yellow
    Write-Host "Nothing to switch. Exiting." -ForegroundColor Yellow
    exit 0
}

# If no target account provided, ask for it
if (-not $TargetAccount) {
    Write-Host "Available GitHub accounts:" -ForegroundColor White
    
    # List authenticated accounts
    $accountList = gh auth status 2>&1 | Select-String -Pattern "Logged in to github.com account (\S+)" -AllMatches
    
    if ($accountList) {
        $accountNames = @()
        foreach ($match in $accountList.Matches) {
            $accountNames += $match.Groups[1].Value
        }
        $accountNames = $accountNames | Select-Object -Unique
        
        foreach ($account in $accountNames) {
            if ($account -eq $currentOwner) {
                Write-Host "    - $account (current repo owner)" -ForegroundColor Green
            } elseif ($ownerType -eq "Organization" -and $account -eq $ACCOUNT_MAP["kage-tech"]) {
                Write-Host "    - $account (recommended for org repos)" -ForegroundColor Green
            } elseif ($ownerType -eq "User" -and $account -eq $ACCOUNT_MAP["personal"]) {
                Write-Host "    - $account (recommended for personal repos)" -ForegroundColor Green
            } else {
                Write-Host "    - $account" -ForegroundColor White
            }
        }
    } else {
        Write-Host "    (No accounts currently authenticated)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    $TargetAccount = Read-Host "Enter target GitHub account/owner name (or 'q' to quit)"
    
    if ($TargetAccount -eq 'q' -or $TargetAccount -eq 'Q') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# Validate target account makes sense for repo type
if ($ownerType -eq "Organization" -and $TargetAccount -eq $ACCOUNT_MAP["personal"]) {
    Write-Host ""
    Write-Host "    [WARNING] You're trying to use personal account '$TargetAccount'" -ForegroundColor Yellow
    Write-Host "              for an organization repo owned by '$currentOwner'." -ForegroundColor Yellow
    Write-Host "              This may not work unless you have access." -ForegroundColor Yellow
    $confirmWarning = Read-Host "    Continue anyway? (y/n)"
    if ($confirmWarning -ne 'y' -and $confirmWarning -ne 'Y') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# Only warn if trying to use isuvo for kage-tech org repos (not for personal repos)
if ($ownerType -eq "User" -and $currentOwner -ne $TargetAccount -and $TargetAccount -eq $ACCOUNT_MAP["personal"] -and $currentOwner -ne $ACCOUNT_MAP["personal"]) {
    Write-Host ""
    Write-Host "    [WARNING] You're trying to use personal account '$TargetAccount'" -ForegroundColor Yellow
    Write-Host "              for a repo owned by '$currentOwner'." -ForegroundColor Yellow
    Write-Host "              This may not work unless you have access." -ForegroundColor Yellow
    $confirmWarning = Read-Host "    Continue anyway? (y/n)"
    if ($confirmWarning -ne 'y' -and $confirmWarning -ne 'Y') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

if ($TargetAccount -eq $currentOwner) {
    # Check if auth also matches
    $currentAuthUser = ""
    $ghStatusCheck = gh auth status 2>&1
    $activeMatch = $ghStatusCheck | Select-String "Active account: true" -Context 0,1
    
    if ($activeMatch) {
        $accountLine = $activeMatch.Context.PostContext | Select-String "account (\S+)"
        if ($accountLine) {
            $currentAuthUser = $accountLine.Matches.Groups[1].Value
        }
    }
    
    # Fallback: get first logged in account
    if (-not $currentAuthUser) {
        $firstAccount = $ghStatusCheck | Select-String "Logged in to github.com account (\S+)"
        if ($firstAccount) {
            $currentAuthUser = $firstAccount.Matches.Groups[1].Value
        }
    }
    
    if ($currentAuthUser -eq $TargetAccount) {
        Write-Host "Already on account: $currentOwner (auth matches)" -ForegroundColor Green
        Write-Host "No switch needed. Exiting." -ForegroundColor Yellow
        exit 0
    } else {
        Write-Host "Repo owner matches ($currentOwner), but auth is: $currentAuthUser" -ForegroundColor Yellow
        Write-Host "Proceeding to switch auth account..." -ForegroundColor Yellow
    }
}

# Confirm switch
Write-Host ""
if ($TargetAccount -eq $currentOwner) {
    Write-Host "Auth switch only (repo owner stays: $currentOwner)" -ForegroundColor Yellow
    Write-Host "Switch auth from: $currentAuthUser" -ForegroundColor Yellow
    Write-Host "Switch auth to:   $TargetAccount" -ForegroundColor Green
} else {
    Write-Host "Switch from: $currentOwner/$currentRepo" -ForegroundColor Yellow
    Write-Host "Switch to:   $TargetAccount/$currentRepo" -ForegroundColor Green
}
$confirm = Read-Host "`nProceed with switch? (y/n)"

if ($confirm -ne 'y' -and $confirm -ne 'Y') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

# ============================================================
# STEP 4: Execute git/gh authentication and switch
# ============================================================

Write-Host "`n[STEP 4] Executing Switch" -ForegroundColor Cyan

# Step 4a: Check if gh is authenticated to target account
Write-Host "    Checking GitHub CLI authentication..." -ForegroundColor Gray

# Check if target account is already in the list of authenticated accounts
$allAccounts = gh auth status 2>&1 | Select-String -Pattern "Logged in to github.com account (\S+)" -AllMatches
$isTargetAuthenticated = $false

if ($allAccounts) {
    foreach ($match in $allAccounts.Matches) {
        if ($match.Groups[1].Value -eq $TargetAccount) {
            $isTargetAuthenticated = $true
            break
        }
    }
}

if ($isTargetAuthenticated) {
    # Target account is already authenticated - just switch to it
    Write-Host "    $TargetAccount is already authenticated. Switching..." -ForegroundColor Green
    Write-Host "    Running: gh auth switch --user $TargetAccount" -ForegroundColor Gray
    
    gh auth switch --user $TargetAccount 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    [OK] Switched to $TargetAccount" -ForegroundColor Green
    } else {
        Write-Host "    [WARNING] Could not switch active account." -ForegroundColor Yellow
        Write-Host "    You can manually switch with: gh auth switch --user $TargetAccount" -ForegroundColor Yellow
    }
} else {
    # Target account is NOT authenticated - need to login via browser
    Write-Host "    $TargetAccount is NOT authenticated." -ForegroundColor Yellow
    Write-Host "    Initiating browser-based login..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    A browser window will open for GitHub authentication." -ForegroundColor Cyan
    Write-Host "    Please log in with the $TargetAccount account." -ForegroundColor Cyan
    Write-Host "    After completing auth in the browser, come back here." -ForegroundColor Cyan
    Write-Host ""
    
    # Use gh auth login with web browser flow
    Write-Host "    Running: gh auth login -p https -h github.com -w" -ForegroundColor Gray
    gh auth login -p https -h github.com -w 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "    [ERROR] Login failed or was cancelled." -ForegroundColor Red
        Write-Host "    Please try again manually:" -ForegroundColor Yellow
        Write-Host "      gh auth login -p https -h github.com -w" -ForegroundColor Yellow
        Write-Host ""
        $retryLogin = Read-Host "    Press Enter to retry, or 'q' to quit"
        
        if ($retryLogin -eq 'q' -or $retryLogin -eq 'Q') {
            Write-Host "Aborted." -ForegroundColor Yellow
            exit 1
        }
        
        gh auth login -p https -h github.com -w 2>&1
    }
    
    # Verify the login succeeded
    Write-Host ""
    Write-Host "    Verifying authentication..." -ForegroundColor Gray
    $verifyStatus = gh auth status 2>&1
    $verifyUser = ($verifyStatus | Select-String "Logged in to github.com account\s+(\S+)").Matches.Groups[1].Value
    
    if ($verifyUser -eq $TargetAccount) {
        Write-Host "    [OK] Successfully authenticated as $TargetAccount" -ForegroundColor Green
    } else {
        Write-Host "    [WARNING] Auth verification shows: $verifyUser" -ForegroundColor Yellow
        Write-Host "    Expected: $TargetAccount" -ForegroundColor Yellow
        Write-Host "    Please verify you logged in with the correct account." -ForegroundColor Yellow
    }
}

# Step 4b: Update git remote URL
Write-Host "    Updating git remote URL..." -ForegroundColor Gray

$newRemoteUrl = "https://github.com/$TargetAccount/$currentRepo.git"
git remote set-url origin $newRemoteUrl

if ($LASTEXITCODE -eq 0) {
    Write-Host "    [OK] Remote URL updated to: $newRemoteUrl" -ForegroundColor Green
} else {
    Write-Host "    [ERROR] Failed to update remote URL." -ForegroundColor Red
    exit 1
}

# ============================================================
# STEP 5: Confirm the switch
# ============================================================

Write-Host "`n[STEP 5] Confirmation" -ForegroundColor Cyan

# Verify new remote
$newRemote = git remote get-url origin
$newOwner = ""
$newRepo = ""

if ($newRemote -match "github\.com[:/](.+?)/(.+?)(?:\.git)?$") {
    $newOwner = $Matches[1]
    $newRepo = $Matches[2]
}

# Verify gh auth - check current status
$finalGhStatus = gh auth status 2>&1
$finalUser = "unknown"

# Parse the first logged in account
$accountMatch = $finalGhStatus | Select-String "Logged in to github.com account (\S+)"
if ($accountMatch) {
    $finalUser = $accountMatch.Matches.Groups[1].Value
}

Write-Host "    New Remote URL:  $newRemote" -ForegroundColor White
Write-Host "    New Owner:       $newOwner" -ForegroundColor White
Write-Host "    Repository:      $newRepo" -ForegroundColor White
Write-Host "    Authenticated:   $finalUser" -ForegroundColor White

# Final verification
$success = $true

if ($newOwner -ne $TargetAccount) {
    Write-Host "`n    [FAIL] Remote owner mismatch!" -ForegroundColor Red
    $success = $false
}

if ($finalUser -ne $TargetAccount) {
    Write-Host "    [FAIL] Auth account mismatch!" -ForegroundColor Red
    $success = $false
}

if ($success) {
    Write-Host "`n    [SUCCESS] Switch completed!" -ForegroundColor Green
    Write-Host "    Repository: $TargetAccount/$currentRepo" -ForegroundColor Green
    
    # Add context about what was switched
    if ($ownerType -eq "Organization") {
        Write-Host "    Note: Repo belongs to kage-tech organization" -ForegroundColor Yellow
        Write-Host "          Using org member account: $TargetAccount" -ForegroundColor Yellow
    } else {
        Write-Host "    Note: Repo belongs to personal account" -ForegroundColor Yellow
        Write-Host "          Using personal account: $TargetAccount" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n    [PARTIAL] Some steps may have failed." -ForegroundColor Yellow
    Write-Host "    Please verify manually." -ForegroundColor Yellow
}

Write-Host ""
