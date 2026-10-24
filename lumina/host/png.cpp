// Lumina OS — PNG encoder. Uses uncompressed ("stored") deflate blocks so the
// build has zero third-party dependencies while still producing valid PNGs.
// SPDX-License-Identifier: MIT
#include "png.hpp"

#include <cstdio>
#include <cstring>
#include <vector>

namespace lumina {
namespace {

using Bytes = std::vector<unsigned char>;

void put_u32(Bytes& out, std::uint32_t v) {
  out.push_back(static_cast<unsigned char>(v >> 24));
  out.push_back(static_cast<unsigned char>(v >> 16));
  out.push_back(static_cast<unsigned char>(v >> 8));
  out.push_back(static_cast<unsigned char>(v));
}

std::uint32_t crc32(const unsigned char* data, size_t len, std::uint32_t crc = 0xFFFFFFFFu) {
  static std::uint32_t table[256];
  static bool ready = false;
  if (!ready) {
    for (std::uint32_t i = 0; i < 256; ++i) {
      std::uint32_t c = i;
      for (int k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      table[i] = c;
    }
    ready = true;
  }
  for (size_t i = 0; i < len; ++i) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
  return crc;
}

std::uint32_t adler32(const unsigned char* data, size_t len) {
  std::uint32_t a = 1, b = 0;
  for (size_t i = 0; i < len; ++i) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

void write_chunk(Bytes& out, const char* type, const Bytes& data) {
  put_u32(out, static_cast<std::uint32_t>(data.size()));
  const size_t start = out.size();
  out.insert(out.end(), type, type + 4);
  out.insert(out.end(), data.begin(), data.end());
  const std::uint32_t crc = crc32(out.data() + start, out.size() - start) ^ 0xFFFFFFFFu;
  put_u32(out, crc);
}

}  // namespace

bool write_png(const Surface& surface, const std::string& path) {
  const int w = surface.width();
  const int h = surface.height();
  if (w <= 0 || h <= 0) return false;

  Bytes raw;
  raw.reserve(static_cast<size_t>(h) * (static_cast<size_t>(w) * 4 + 1));
  for (int y = 0; y < h; ++y) {
    raw.push_back(0);  // filter: none
    const u32* row = surface.row(y);
    for (int x = 0; x < w; ++x) {
      const u32 p = row[x];
      raw.push_back(static_cast<unsigned char>((p >> 16) & 0xFF));
      raw.push_back(static_cast<unsigned char>((p >> 8) & 0xFF));
      raw.push_back(static_cast<unsigned char>(p & 0xFF));
      raw.push_back(static_cast<unsigned char>((p >> 24) & 0xFF));
    }
  }

  // zlib stream: header + stored deflate blocks + adler32.
  Bytes z;
  z.push_back(0x78);
  z.push_back(0x01);
  const size_t max_block = 65535;
  size_t offset = 0;
  while (offset < raw.size()) {
    const size_t len = (raw.size() - offset) > max_block ? max_block : (raw.size() - offset);
    const bool final_block = (offset + len) >= raw.size();
    z.push_back(final_block ? 1 : 0);
    z.push_back(static_cast<unsigned char>(len & 0xFF));
    z.push_back(static_cast<unsigned char>((len >> 8) & 0xFF));
    z.push_back(static_cast<unsigned char>(~len & 0xFF));
    z.push_back(static_cast<unsigned char>((~len >> 8) & 0xFF));
    z.insert(z.end(), raw.begin() + static_cast<long>(offset),
             raw.begin() + static_cast<long>(offset + len));
    offset += len;
  }
  put_u32(z, adler32(raw.data(), raw.size()));

  Bytes png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
  Bytes ihdr;
  put_u32(ihdr, static_cast<std::uint32_t>(w));
  put_u32(ihdr, static_cast<std::uint32_t>(h));
  ihdr.push_back(8);  // bit depth
  ihdr.push_back(6);  // colour type RGBA
  ihdr.push_back(0);
  ihdr.push_back(0);
  ihdr.push_back(0);
  write_chunk(png, "IHDR", ihdr);
  write_chunk(png, "IDAT", z);
  write_chunk(png, "IEND", {});

  std::FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return false;
  std::fwrite(png.data(), 1, png.size(), f);
  std::fclose(f);
  return true;
}

}  // namespace lumina
