#pragma once

#include <pcap/pcap.h>
#include <stdint.h>
#include <uuid/uuid.h>

/*
 * The pktap pseudo-interface prepends a metadata header (with process
 * attribution) to every captured packet when the capture is opened with
 * the Apple-private pcap_set_want_pktap(). net/pktap.h is not in the
 * public macOS SDK, so the layout is declared here, mirroring xnu
 * bsd/net/pktap.h. Field offsets have been stable across macOS releases;
 * parsers must still honor pth_length from the wire rather than assuming
 * sizeof(gargoyle_pktap_header) matches the running kernel.
 */

#define GARGOYLE_PKTAP_IFXNAMESIZE 24  /* IF_NAMESIZE (16) + 8 */
#define GARGOYLE_MAXCOMLEN 16

/*
 * Apple's libpcap reports pktap as DLT_USER2 (149), its original private
 * assignment; 258 is the later official libpcap allocation. Verified on
 * macOS 26 (2026-07-11): the live capture reports 149.
 */
#define GARGOYLE_DLT_PKTAP        258
#define GARGOYLE_DLT_PKTAP_DARWIN 149

/* pth_flags */
#define GARGOYLE_PTH_FLAG_DIR_IN  0x00000001
#define GARGOYLE_PTH_FLAG_DIR_OUT 0x00000002

struct gargoyle_timeval32 {
    uint32_t tv_sec;
    uint32_t tv_usec;
};

struct gargoyle_pktap_header {
    uint32_t pth_length;            /* length of this header on the wire */
    uint32_t pth_type_next;         /* type of data following */
    uint32_t pth_dlt;               /* DLT of the inner packet */
    char     pth_ifname[GARGOYLE_PKTAP_IFXNAMESIZE];
    uint32_t pth_flags;
    uint32_t pth_protocol_family;
    uint32_t pth_frame_pre_length;
    uint32_t pth_frame_post_length;
    int32_t  pth_pid;               /* process that owns the socket */
    char     pth_comm[GARGOYLE_MAXCOMLEN + 1];
    uint32_t pth_svc;               /* service class */
    uint16_t pth_iftype;
    uint16_t pth_ifunit;
    int32_t  pth_epid;              /* effective (delegate) process */
    char     pth_ecomm[GARGOYLE_MAXCOMLEN + 1];
    uint32_t pth_flowid;
    uint32_t pth_ipproto;
    struct gargoyle_timeval32 pth_tstamp;
    uuid_t   pth_uuid;
    uuid_t   pth_euuid;
};
