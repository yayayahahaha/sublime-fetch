#!/bin/bash

# --- Domain Delegation Analyzer (v7) ---
# This script analyzes the DNS delegation chain for a given domain
# to determine which entity manages the DNS for each level of the domain.
# v7 removes dependency on Bash v4+ (associative arrays).

# --- Configuration ---
# Color codes for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- Helper Functions ---
print_header() {
  echo -e "\n${PURPLE}==================================================${NC}"
  echo -e "  ${CYAN}$1: ${YELLOW}$2${NC}"
  echo -e "${PURPLE}==================================================${NC}"
}

print_section() {
  echo -e "\n${BLUE}# $1${NC}"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# --- Main Logic ---
main() {
  # 1. Input Validation
  if [ -z "$1" ]; then
    echo -e "${RED}用法: $0 <domain>${NC}"
    echo "範例: $0 exchange.freedx.com"
    exit 1
  fi

  for cmd in dig awk grep cut; do
    if ! command_exists "$cmd"; then
      echo -e "${RED}錯誤: 缺少必要的指令 '$cmd'。${NC}"
      exit 1
    fi
  done
  
  local FQDN="$1"
  print_header "DNS 委派鏈分析報告" "$FQDN"

  local current_domain="$FQDN"
  local levels=()
  local summary_lines="" # Use a multi-line string instead of an array
  
  # First, create a list of all domain levels to analyze
  while [[ "$current_domain" == *.* ]]; do
    levels+=("$current_domain")
    # Move to the parent domain
    parent_domain=$(echo "$current_domain" | cut -d. -f2-)
    # Break if parent is a TLD like 'com' or 'co.uk'
    if [[ "$parent_domain" == "$current_domain" ]]; then
      break
    fi
    current_domain=$parent_domain
  done

  # --- Print Analysis by iterating through levels ---
  for (( i=0; i<${#levels[@]}; i++ )) ; do
    local level="${levels[$i]}"
    
    print_section "分析層級: $level"
    
    local ns_records
    ns_records=$(dig +short NS "$level")
    
    if [ -n "$ns_records" ]; then
        local first_ns
        first_ns=$(echo "$ns_records" | head -n 1)
        
        local dns_provider="未知"
        if echo "$first_ns" | grep -q "awsdns"; then
            dns_provider="Amazon Route 53"
        elif echo "$first_ns" | grep -q "cloudflare"; then
            dns_provider="Cloudflare"
        elif echo "$first_ns" | grep -q "domaincontrol"; then
            dns_provider="GoDaddy"
        elif echo "$first_ns" | grep -q "googledomains"; then
            dns_provider="Google Cloud DNS"
        fi
        
        echo -e "  -> ${GREEN}找到獨立的 NS 紀錄。${NC}"
        echo -e "  -> ${GREEN}DNS 服務商: $dns_provider${NC}"
        summary_lines+="- 網域 '$level' 是一個**委派**的 DNS Zone，由 ${GREEN}$dns_provider${NC} 管理。\n"
    else
        echo -e "  -> ${YELLOW}找不到獨立的 NS 紀錄，繼承自父層的 DNS 設定。${NC}"
        summary_lines+="- 子網域 '$level' ${YELLOW}繼承了${NC}其父層的 DNS 管理。\n"
    fi
  done
  
  # --- Print Summary ---
  print_section "總結"
  # Use printf to correctly interpret newlines
  printf -- "$summary_lines"
  echo ""
}

main "$@"
