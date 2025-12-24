#!/bin/bash

# --- Domain Analysis Script (v10 - Final) ---
# This script performs a multi-layered analysis of a given domain.
# v10 fixes the NS/CNAME logic bug and improves DNS provider display.

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
  echo -e "${BLUE}--------------------------------------------${NC}"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# --- Main Logic ---
main() {
  # 1. Input Validation
  if [ -z "$1" ]; then
    echo -e "${RED}用法: $0 <domain>${NC}"
    echo "範例: $0 google.com"
    exit 1
  fi

  for cmd in dig whois curl awk grep sed head tail; do
    if ! command_exists "$cmd"; then
      echo -e "${RED}錯誤: 缺少必要的指令 '$cmd'。${NC}"
      exit 1
    fi
  done

  local DOMAIN="$1"
  print_header "DNS 與網站服務分析報告" "$DOMAIN"

  # --- Data Collection ---
  local final_ips
  final_ips=$(dig +short A "$DOMAIN" | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}$')
  local cname_path
  cname_path=$(dig +short CNAME "$DOMAIN")

  # 2. DNS Resolution Path
  print_section "1. DNS 解析路徑 (DNS Resolution Path)"
  
  echo "    [ ] -> $DOMAIN"
  if [ -n "$cname_path" ]; then
      local current_cname=$cname_path
      echo "        |"
      echo "        +-> [CNAME] $current_cname"
      while true; do
          next_cname=$(dig +short CNAME "$current_cname")
          if [ -z "$next_cname" ]; then
              break
          fi
          echo "        |"
          echo "        +-> [CNAME] $next_cname"
          current_cname=$next_cname
      done
  fi

  echo "        |"
  echo "        +-> [A] 最終 A 紀錄 (Final A Record(s)):"
  if [ -z "$final_ips" ]; then
      echo "            - 在解析鏈的末端找不到 A 紀錄。"
  else
      while read -r ip; do
      echo "            - $ip"
      done <<< "$final_ips"
  fi

  if [ -n "$cname_path" ]; then
      echo -e "\n    * ${GREEN}分析:${NC} 此網域透過 CNAME 鏈進行解析。"
  else
      if [ -n "$final_ips" ]; then
          echo -e "\n    * ${GREEN}分析:${NC} 此網域直接解析至 A 紀錄。"
      else
          echo -e "\n    * ${GREEN}分析:${NC} 找不到此網域的 CNAME 或 A 紀錄。"
          echo "      (這對於僅擁有 NS/SOA 紀錄的根網域來說可能是正常情況)。"
      fi
  fi

  # 3. IP Ownership
  print_section "2. IP 位址歸屬 (IP Ownership)"
  local first_ip
  first_ip=$(echo "$final_ips" | head -n 1)
  
  if [ -z "$first_ip" ]; then
    echo "    無法確定最終的 IP 位址。"
  else
    echo "    - 最終 IP: $first_ip"
    local whois_output
    whois_output=$(whois "$first_ip")
    local org_name
    org_name=$(echo "$whois_output" | grep -iE '^(OrgName|Organization|owner|netname):' | head -n 1 | sed -e 's/^[A-Za-z-]*:[ \t]*//' | sed 's/\r//g' | xargs)
    
    if [ -z "$org_name" ]; then
      org_name=$(echo "$whois_output" | grep -iE '^(descr):' | head -n 1 | sed -e 's/^[A-Za-z-]*:[ \t]*//' | sed 's/\r//g' | xargs)
    fi
    
    if [ -z "$org_name" ]; then
      org_name="未知"
    fi

    echo "    - 所屬組織: $org_name"
    echo -e "\n    * ${GREEN}分析:${NC} 最終的 IP 位址歸屬於 **$org_name**。"
  fi

  # 4. DNS Delegation Chain Analysis (v10 - Bugfix for NS/CNAME confusion)
  print_section "3. DNS 委派鏈分析 (DNS Delegation Chain)"
  local current_domain_delegation="$DOMAIN"
  local levels=()
  local summary_lines=""
  
  while [[ "$current_domain_delegation" == *.* ]]; do
    levels+=("$current_domain_delegation")
    parent_domain=$(echo "$current_domain_delegation" | cut -d. -f2-)
    if [[ "$parent_domain" == "$current_domain_delegation" ]]; then
      break
    fi
    current_domain_delegation=$parent_domain
  done

  for (( i=0; i<${#levels[@]}; i++ )) ; do
    local level="${levels[$i]}"
    
    local analysis_line=""
    # FIX: First check if the level itself is a CNAME. If so, it cannot have NS records.
    local cname_check
    cname_check=$(dig +short CNAME "$level")
    if [ -n "$cname_check" ]; then
      analysis_line="- 層級 '${level}' ${YELLOW}繼承了${NC}其父層的 DNS 管理 (因其本身為 CNAME)。"
    else
      local ns_records
      ns_records=$(dig +short NS "$level")
      
      if [ -n "$ns_records" ]; then
          local first_ns=$(echo "$ns_records" | head -n 1)
          local dns_provider_friendly="未知"
          
          if echo "$first_ns" | grep -q "awsdns"; then dns_provider_friendly="Amazon Route 53";
          elif echo "$first_ns" | grep -q "cloudflare"; then dns_provider_friendly="Cloudflare";
          elif echo "$first_ns" | grep -q "domaincontrol"; then dns_provider_friendly="GoDaddy";
          elif echo "$first_ns" | grep -q "googledomains"; then dns_provider_friendly="Google Cloud DNS";
          fi
          
          if [ "$dns_provider_friendly" != "未知" ]; then
              analysis_line="- 層級 '${level}' 是一個**委派**的 DNS Zone，由 ${GREEN}$dns_provider_friendly (${first_ns})${NC} 管理。"
          else
              # If provider is not in our list, just show the raw NS record
              analysis_line="- 層級 '${level}' 是一個**委派**的 DNS Zone，由 ${GREEN}${first_ns}${NC} 管理。"
          fi
      else
          analysis_line="- 層級 '${level}' ${YELLOW}繼承了${NC}其父層的 DNS 管理。"
      fi
    fi
    summary_lines+="$analysis_line\n"
  done
  printf -- "$summary_lines"

  # 5. HTTP Service Analysis
  print_section "4. HTTP 服務分析 (HTTP Service Analysis)"
  local curl_output
  curl_output=$(curl -s -L -o /dev/null -w "\n%{url_effective}" -D - "$DOMAIN")

  if [ -z "$curl_output" ]; then
    echo "    無法獲取 HTTP 標頭。"
  else
    local final_url=$(echo "$curl_output" | tail -n 1)
    local all_headers=$(echo "$curl_output" | sed '$d')
    local final_headers=$(echo "$all_headers" | awk '/^HTTP\// {buffer=""} {buffer=buffer $0 "\n"} END {printf "%s", buffer}' | sed 's/\r//g')
    
    local status_code=$(echo "$final_headers" | head -n 1 | awk '{for (i=2; i<=NF; i++) printf $i " "; print ""}' | xargs)
    local server_header=$(echo "$final_headers" | grep -i '^server:' | awk '{$1=""; print $0}' | xargs)
    local via_header=$(echo "$final_headers" | grep -i '^via:' | awk '{$1=""; print $0}' | xargs)
    local xcache_header=$(echo "$final_headers" | grep -i '^x-cache:' | awk '{$1=""; print $0}' | xargs)

    echo "    - 最終 URL (重新導向後): $final_url"
    echo "    - 最終 HTTP 狀態: $status_code"
    echo "    - 關鍵標頭 (Key Headers):"
    [ ! -z "$server_header" ] && echo "        - Server: $server_header"
    [ ! -z "$via_header" ] && echo "        - via: $via_header"
    [ ! -z "$xcache_header" ] && echo "        - x-cache: $xcache_header"
    
    local http_provider="未知"
    if echo "$server_header" | grep -qi "cloudfront" || echo "$via_header" | grep -qi "cloudfront"; then http_provider="AWS CloudFront";
    elif echo "$server_header" | grep -qi "cloudflare"; then http_provider="Cloudflare";
    elif echo "$server_header" | grep -qi "amazons3"; then http_provider="Amazon S3";
    elif [ ! -z "$server_header" ]; then http_provider="$server_header";
    fi
    echo -e "\n    * ${GREEN}分析:${NC} 網站內容似乎由 **$http_provider** 提供服務或代理。"
  fi
  
  echo ""
}

main "$@"