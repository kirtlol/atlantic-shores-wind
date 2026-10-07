import zlib, struct, numpy as np
def load(path):
    d=open(path,'rb').read()
    assert d[:8]==b'\x89PNG\r\n\x1a\n'
    i=8; idat=b''; info={}
    while i<len(d):
        L=struct.unpack('>I',d[i:i+4])[0]; t=d[i+4:i+8]; c=d[i+8:i+8+L]; i+=12+L
        if t==b'IHDR':
            w,h,bd,ct,cm,fm,il=struct.unpack('>IIBBBBB',c); info.update(w=w,h=h,bd=bd,ct=ct,il=il)
        elif t==b'IDAT': idat+=c
        else: info.setdefault('chunks',[]).append((t.decode(),L, c[:40]))
    w,h,bd,ct=info['w'],info['h'],info['bd'],info['ct']
    assert bd==8 and info['il']==0
    ch={2:3,6:4,0:1,4:2}[ct]
    raw=zlib.decompress(idat); stride=w*ch
    out=np.zeros((h,stride),np.uint8); prev=np.zeros(stride,np.int32)
    p=0
    for y in range(h):
        f=raw[p]; line=np.frombuffer(raw[p+1:p+1+stride],np.uint8).astype(np.int32); p+=1+stride
        if f==0: cur=line
        elif f==1:
            cur=line.copy()
            for x in range(ch,stride): cur[x]=(cur[x]+cur[x-ch])&255
        elif f==2: cur=(line+prev)&255
        elif f==3:
            cur=line.copy()
            for x in range(stride):
                a=cur[x-ch] if x>=ch else 0
                cur[x]=(cur[x]+((a+prev[x])>>1))&255
        elif f==4:
            cur=line.copy()
            for x in range(stride):
                a=cur[x-ch] if x>=ch else 0; b=prev[x]; c=prev[x-ch] if x>=ch else 0
                pa=abs(b-c); pb=abs(a-c); pc=abs(a+b-2*c)
                pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                cur[x]=(cur[x]+pr)&255
        out[y]=cur; prev=cur
    return out.reshape(h,w,ch), info
if __name__=='__main__':
    import sys  # the reference photo (Borkum Riffgrund 1) is not included: pass its path
    im,info=load(sys.argv[1] if len(sys.argv) > 1 else 'reference/ref-1.png')
    print(im.shape, info)
    np.save('ref.npy', im)
