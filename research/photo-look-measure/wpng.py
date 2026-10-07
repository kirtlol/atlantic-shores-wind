import zlib, struct, numpy as np
def save(path, a):
    a=np.ascontiguousarray(a.astype(np.uint8)); h,w=a.shape[:2]; ch=a.shape[2] if a.ndim==3 else 1
    ct={1:0,3:2,4:6}[ch]
    raw=b''.join(b'\x00'+a[y].tobytes() for y in range(h))
    def chunk(t,c): return struct.pack('>I',len(c))+t+c+struct.pack('>I',zlib.crc32(t+c)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,ct,0,0,0))+chunk(b'IDAT',zlib.compress(raw,6))+chunk(b'IEND',b''))
def crop_up(im,x0,y0,x1,y1,s,grid=None):
    c=im[y0:y1,x0:x1].repeat(s,0).repeat(s,1).copy()
    if grid:
        for yy in range(0,y1-y0,grid): c[yy*s,:]=[255,0,255]
        for xx in range(0,x1-x0,grid): c[:,xx*s]=[255,0,255]
    return c
